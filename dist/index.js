// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var UNAUTHED_ERR_MSG = "Unauthorized";
var NOT_ADMIN_ERR_MSG = "Not an admin";
var COOKIE_NAME = "auth_token";
var ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1e3;
var AXIOS_TIMEOUT_MS = 3e4;

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var searchAnalytics = mysqlTable("search_analytics", {
  id: int("id").autoincrement().primaryKey(),
  query: text("query").notNull(),
  translatedQuery: text("translatedQuery"),
  language: varchar("language", { length: 10 }).default("en").notNull(),
  resultsFound: int("resultsFound").default(0).notNull(),
  topResultUrl: text("topResultUrl"),
  topResultName: text("topResultName"),
  sessionId: varchar("sessionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var resourceClicks = mysqlTable("resource_clicks", {
  id: int("id").autoincrement().primaryKey(),
  resourceUrl: text("resourceUrl").notNull(),
  resourceName: text("resourceName").notNull(),
  category: varchar("category", { length: 50 }),
  query: text("query"),
  sessionId: varchar("sessionId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  message: text("message").notNull(),
  language: varchar("language", { length: 10 }).default("en"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/routers.ts
import { z } from "zod";

// server/_core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/groqAI.ts
import Groq from "groq-sdk";
var groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});
var SYSTEM_PROMPT = `You are MySchool Assistant for portal.myschoolct.com.

Your role: Help users find educational resources quickly.

RESPOND IN JSON ONLY with this format:
{"message": "response", "searchQuery": "term or null", "searchType": "greeting|direct_search|class_subject|invalid", "classNum": null, "subject": null, "suggestions": []}

RULES (FOLLOW STRICTLY):

1. GREETINGS - Use searchType: "greeting", searchQuery: null
   Examples: hi, hello, hey, how are you, good morning, what's up, howdy, greetings
   Response: {"message": "Hello! I'm your MySchool Assistant. How can I help you find educational resources today?", "searchQuery": null, "searchType": "greeting", "classNum": null, "subject": null, "suggestions": ["Search for animals", "Class 5 Maths", "Exam tips"]}

2. CLASS + SUBJECT - Use searchType: "class_subject" (ONLY when class number is specified)
   Examples: class 5 maths, class 3 science, grade 10 english
   Response: {"message": "Opening Class 5 Maths!", "searchQuery": null, "searchType": "class_subject", "classNum": 5, "subject": "maths", "suggestions": []}

3. DIRECT SEARCH - Use searchType: "direct_search" for everything else
   Examples: lion, monkey, flowers, puzzle, animals, maths worksheets, exam tips
   Response: {"message": "Here are results for lion!", "searchQuery": "lion", "searchType": "direct_search", "classNum": null, "subject": null, "suggestions": []}

4. INTERVIEW QUERIES - Map to "exam tips"
   Examples: interview, interview tips, interview preparation
   Response: {"message": "Here are exam tips!", "searchQuery": "exam tips", "searchType": "direct_search", "classNum": null, "subject": null, "suggestions": []}

5. INVALID/GIBBERISH - Use searchType: "invalid"
   Examples: asdfgh, ;lkjasdf, random characters
   Response: {"message": "Let me help you find something!", "searchQuery": null, "searchType": "invalid", "classNum": null, "subject": null, "suggestions": ["Animals", "Class 5 Maths"]}

IMPORTANT:
- Conversational queries like "how are you", "what can you do", "help me" are GREETINGS
- Only use class_subject when user explicitly mentions a class NUMBER (1-10)
- searchQuery should be the exact search term, not modified
`;
async function getAIResponse(userMessage, history = []) {
  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-4),
      { role: "user", content: userMessage }
    ];
    const completion = await groq.chat.completions.create({
      messages,
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return {
      message: parsed.message || "How can I help?",
      searchQuery: parsed.searchQuery || null,
      searchType: parsed.searchType || "direct_search",
      classNum: parsed.classNum || null,
      subject: parsed.subject || null,
      suggestions: parsed.suggestions || []
    };
  } catch (error) {
    console.error("Groq error:", error);
    return {
      message: "Hello! How can I help you find educational resources today?",
      searchQuery: null,
      searchType: "greeting",
      classNum: null,
      subject: null,
      suggestions: ["Search for animals", "Explore Class 5 Maths", "Find exam tips"]
    };
  }
}

// server/chatbotDb.ts
import { desc, eq as eq2 } from "drizzle-orm";
async function saveChatMessage(message) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(chatMessages).values(message);
  return result;
}

// server/analyticsDb.ts
import { desc as desc2, sql } from "drizzle-orm";
async function logSearchQuery(data) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(searchAnalytics).values(data);
  } catch (error) {
  }
}

// server/translation_util.ts
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
var groq2 = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});
async function translateAndExtractKeyword(text2) {
  if (/^[a-zA-Z0-9\s.,!?-]+$/.test(text2)) {
    return { translatedText: text2, keyword: text2 };
  }
  try {
    const response = await groq2.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a translation assistant for MySchool educational portal. 
Your task:
1. Detect the language (Telugu, Hindi, Gujarati, Tamil, or other Indian languages)
2. Translate the input to English accurately
3. Extract the most important keyword for educational resource search

Return JSON format: {"translatedText": "...", "keyword": "..."}

Examples:
Telugu "\u0C1C\u0C02\u0C24\u0C41\u0C35\u0C41\u0C32 \u0C1A\u0C3F\u0C24\u0C4D\u0C30\u0C3E\u0C32\u0C41" \u2192 {"translatedText": "animal images", "keyword": "animals"}
Telugu "\u0C2A\u0C02\u0C21\u0C41" \u2192 {"translatedText": "fruit", "keyword": "fruit"}
Hindi "\u0915\u0915\u094D\u0937\u093E 5 \u0917\u0923\u093F\u0924" \u2192 {"translatedText": "class 5 maths", "keyword": "maths"}
Gujarati "\u0AB5\u0ABF\u0A9C\u0ACD\u0A9E\u0ABE\u0AA8 \u0AAA\u0AB0\u0AC0\u0A95\u0ACD\u0AB7\u0ABE" \u2192 {"translatedText": "science exam", "keyword": "science"}

IMPORTANT: Translate single words directly. "\u0C2A\u0C02\u0C21\u0C41" means "fruit" in English.`
        },
        {
          role: "user",
          content: text2
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 150
    });
    const result = JSON.parse(response.choices[0].message.content || '{"translatedText": "", "keyword": ""}');
    const translatedText = result.translatedText?.trim() || text2;
    const keyword = result.keyword?.trim() || translatedText;
    console.log(`[Translation] Original: "${text2}" \u2192 Translated: "${translatedText}" (Keyword: "${keyword}")`);
    return {
      translatedText,
      keyword
    };
  } catch (error) {
    console.error("Translation error:", error);
    return { translatedText: text2, keyword: text2 };
  }
}

// server/routers.ts
var BASE_URL = "https://portal.myschoolct.com";
var PORTAL_API = "https://portal.myschoolct.com/api/rest/search/global";
var OCRC_CATEGORIES = {
  "animals": { path: "/views/academic/imagebank/animals", mu: 0 },
  "animal": { path: "/views/academic/imagebank/animals", mu: 0 },
  "birds": { path: "/views/academic/imagebank/birds", mu: 1 },
  "bird": { path: "/views/academic/imagebank/birds", mu: 1 },
  "flowers": { path: "/views/academic/imagebank/flowers", mu: 2 },
  "flower": { path: "/views/academic/imagebank/flowers", mu: 2 },
  "fruits": { path: "/views/academic/imagebank/fruits", mu: 3 },
  "fruit": { path: "/views/academic/imagebank/fruits", mu: 3 },
  "vegetables": { path: "/views/academic/imagebank/vegetables", mu: 4 },
  "vegetable": { path: "/views/academic/imagebank/vegetables", mu: 4 },
  "plants": { path: "/views/academic/imagebank/plants", mu: 5 },
  "plant": { path: "/views/academic/imagebank/plants", mu: 5 },
  "insects": { path: "/views/academic/imagebank/insects", mu: 6 },
  "insect": { path: "/views/academic/imagebank/insects", mu: 6 },
  "professions": { path: "/views/academic/imagebank/professions", mu: 7 },
  "comics": { path: "/views/sections/comics", mu: 8 },
  "rhymes": { path: "/views/sections/rhymes", mu: 1 },
  "stories": { path: "/views/sections/pictorial-stories", mu: 2 },
  "festivals": { path: "/views/sections/imagebank/festivals", mu: 0 },
  "vehicles": { path: "/views/sections/imagebank/vehicles", mu: 0 },
  "puzzles": { path: "/views/sections/puzzles-riddles", mu: 0 }
};
var SUBJECT_MU = {
  "english": 0,
  "eng": 0,
  "hindi": 1,
  "telugu": 2,
  "evs": 3,
  "science": 3,
  "sci": 3,
  "maths": 4,
  "math": 4,
  "mathematics": 4,
  "gk": 5,
  "general knowledge": 5,
  "computer": 6,
  "computers": 6,
  "it": 6,
  "art": 7,
  "drawing": 7,
  "craft": 8,
  "crafts": 8,
  "stories": 9,
  "story": 9,
  "charts": 10,
  "chart": 10
};
var AGE_TO_CLASS = {
  3: "nursery",
  4: "lkg",
  5: "ukg",
  6: "class-1",
  7: "class-2",
  8: "class-3",
  9: "class-4",
  10: "class-5",
  11: "class-6",
  12: "class-7",
  13: "class-8",
  14: "class-9",
  15: "class-10"
};
async function fetchPortalResultsDirect(query, size = 6) {
  try {
    console.log(`\u{1F50D} [PORTAL DIRECT] Fetching: "${query}"`);
    const url = `${PORTAL_API}?query=${encodeURIComponent(query)}&size=${size}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`\u26A0\uFE0F [PORTAL] API error: ${response.status}`);
      return [];
    }
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      console.log(`\u2705 [PORTAL DIRECT] Found ${data.results.length} results`);
      return data.results;
    }
    console.log(`\u26A0\uFE0F [PORTAL DIRECT] No results for "${query}"`);
    return [];
  } catch (error) {
    console.error("\u274C [PORTAL] Error:", error);
    return [];
  }
}
var GREETING_PATTERNS = [/^(hi|hello|hey|hii+|helo|hai|hola)\b/i, /^good\s*(morning|afternoon|evening)/i, /^(what'?s?\s*up|howdy|greetings|namaste)/i];
function isGreeting(message) {
  return GREETING_PATTERNS.some((p) => p.test(message.trim().toLowerCase()));
}
function findSubjectMu(query) {
  const lowerQuery = query.toLowerCase();
  for (const [subj, mu] of Object.entries(SUBJECT_MU)) {
    if (lowerQuery.includes(subj)) return mu;
  }
  return null;
}
function parseClassSubject(query) {
  const classMatch = query.toLowerCase().match(/(?:class|grade|standard)\s*(\d+)/i);
  const subjectMu = findSubjectMu(query);
  return {
    classNum: classMatch ? parseInt(classMatch[1]) : null,
    subjectMu
  };
}
function parseAge(query) {
  const ageMatch = query.toLowerCase().match(/(?:age|year|years?\s*old)\s*(\d+)/i) || query.match(/(\d+)\s*(?:year|years?\s*old)/i);
  return ageMatch ? parseInt(ageMatch[1]) : null;
}
function buildSmartUrl(query, classNum, subjectMu) {
  const lowerQuery = query.toLowerCase().trim();
  if (OCRC_CATEGORIES[lowerQuery]) {
    return `${BASE_URL}${OCRC_CATEGORIES[lowerQuery].path}?main=2&mu=${OCRC_CATEGORIES[lowerQuery].mu}`;
  }
  const age = parseAge(lowerQuery);
  if (age && AGE_TO_CLASS[age]) {
    const className = AGE_TO_CLASS[age];
    if (subjectMu !== null) {
      return `${BASE_URL}/views/academic/class/${className}?main=0&mu=${subjectMu}`;
    }
    return `${BASE_URL}/views/academic/class/${className}`;
  }
  if (classNum && classNum >= 1 && classNum <= 10) {
    const className = `class-${classNum}`;
    if (subjectMu !== null) {
      return `${BASE_URL}/views/academic/class/${className}?main=0&mu=${subjectMu}`;
    }
    return `${BASE_URL}/views/academic/class/${className}`;
  }
  const kinderMatch = lowerQuery.match(/\b(nursery|lkg|ukg)\b/i);
  if (kinderMatch) {
    const kinderClass = kinderMatch[1].toLowerCase();
    if (subjectMu !== null) {
      return `${BASE_URL}/views/academic/class/${kinderClass}?main=0&mu=${subjectMu}`;
    }
    return `${BASE_URL}/views/academic/class/${kinderClass}`;
  }
  return `${BASE_URL}/views/result?text=${encodeURIComponent(query)}`;
}
var appRouter = router({
  chatbot: router({
    autocomplete: publicProcedure.input(z.object({ query: z.string(), language: z.string().optional() })).query(async ({ input }) => {
      if (input.query.length < 2) return { resources: [], images: [] };
      try {
        const portalResults = await fetchPortalResultsDirect(input.query, 6);
        const images = portalResults.map((r) => ({
          id: r.code || r.title,
          url: r.thumbnail || r.path,
          title: r.title,
          category: r.category
        }));
        const { classNum, subjectMu } = parseClassSubject(input.query);
        const url = buildSmartUrl(input.query, classNum, subjectMu);
        const resources = portalResults.length > 0 ? [{
          name: `Browse: "${input.query}"`,
          description: `Found ${portalResults.length} results`,
          url
        }] : [];
        return { resources, images };
      } catch (error) {
        console.error("Autocomplete error:", error);
        return { resources: [], images: [] };
      }
    }),
    chat: publicProcedure.input(z.object({
      message: z.string(),
      sessionId: z.string(),
      language: z.string().optional(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional()
    })).mutation(async ({ input }) => {
      const { message, sessionId, language = "en", history = [] } = input;
      console.log(`
\u{1F3AF} === SEARCH START: "${message}" ===`);
      if (isGreeting(message)) {
        console.log(`\u{1F44B} Greeting detected`);
        let aiMessage = "Hello! I'm your MySchool Assistant. How can I help you find educational resources today?";
        try {
          const r = await getAIResponse(message, history);
          if (r.message) aiMessage = r.message;
        } catch (e) {
        }
        await saveChatMessage({ sessionId, role: "user", message, language });
        await saveChatMessage({ sessionId, role: "assistant", message: aiMessage, language: "en" });
        return {
          response: aiMessage,
          resourceUrl: "",
          resourceName: "",
          resourceDescription: "",
          suggestions: ["Search animals", "Class 5 Maths", "Age 8 resources"],
          searchType: "greeting",
          thumbnails: []
        };
      }
      let searchQuery = message;
      if (language && language !== "en") {
        try {
          const r = await translateAndExtractKeyword(message, language);
          searchQuery = r.translated || message;
        } catch (e) {
        }
      }
      const { classNum, subjectMu } = parseClassSubject(searchQuery);
      const resourceUrl = buildSmartUrl(searchQuery, classNum, subjectMu);
      console.log(`\u{1F517} Smart URL: ${resourceUrl}`);
      let portalResults = await fetchPortalResultsDirect(searchQuery, 6);
      const hasRealResults = portalResults.length > 0;
      let responseMessage;
      let thumbnails = [];
      let resourceName = "";
      let resourceDescription = "";
      let searchType;
      if (hasRealResults) {
        thumbnails = portalResults.map((r) => ({ url: r.path, thumbnail: r.thumbnail, title: r.title, category: r.category }));
        responseMessage = `Found ${portalResults.length} results for "${searchQuery}". Click below to explore!`;
        resourceName = `${portalResults.length} resources found`;
        resourceDescription = portalResults.slice(0, 3).map((r) => r.title).join(", ");
        searchType = "direct_search";
      } else {
        responseMessage = `No images found for "${searchQuery}". Try searching for:
\u2022 Common topics like "animals", "fruits", "flowers"
\u2022 Class-based content like "Class 5 Maths"
\u2022 Or browse our resource categories above!`;
        resourceName = "";
        resourceDescription = "";
        searchType = "no_results";
        thumbnails = [];
      }
      await saveChatMessage({ sessionId, role: "user", message, language });
      await saveChatMessage({ sessionId, role: "assistant", message: responseMessage, language: "en" });
      await logSearchQuery({ sessionId, query: searchQuery, translatedQuery: searchQuery !== message ? searchQuery : null, language, resultsCount: thumbnails.length, topResultUrl: resourceUrl, topResultName: portalResults[0]?.title || "" });
      console.log(`\u2705 === SEARCH COMPLETE (${hasRealResults ? "found" : "no results"}) ===
`);
      return {
        response: responseMessage,
        resourceUrl: hasRealResults ? resourceUrl : "",
        resourceName,
        resourceDescription,
        suggestions: hasRealResults ? [] : ["Animals", "Class 5 English", "Flowers", "Fruits"],
        searchType,
        thumbnails
      };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  root: "./client",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared")
    }
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    minify: "terser",
    sourcemap: false
  },
  server: {
    port: 5173,
    host: true
  },
  preview: {
    port: 4173,
    host: true
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
