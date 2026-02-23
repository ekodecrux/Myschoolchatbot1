import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc";
import { getAIResponse } from "./groqAI";
import { saveChatMessage } from "./chatbotDb";
import { logSearchQuery } from "./analyticsDb";
import { translateAndExtractKeyword } from "./translation_util";

const BASE_URL = "https://portal.myschoolct.com";
const PORTAL_API = "https://portal.myschoolct.com/api/rest/search/global";

// Number of results to show in chatbot (top 5)
const CHATBOT_RESULTS_LIMIT = 5;

const OCRC_CATEGORIES: Record<string, { path: string; mu: number }> = {
  'animals': { path: '/views/academic/imagebank/animals', mu: 0 },
  'animal': { path: '/views/academic/imagebank/animals', mu: 0 },
  'birds': { path: '/views/academic/imagebank/birds', mu: 1 },
  'bird': { path: '/views/academic/imagebank/birds', mu: 1 },
  'flowers': { path: '/views/academic/imagebank/flowers', mu: 2 },
  'flower': { path: '/views/academic/imagebank/flowers', mu: 2 },
  'fruits': { path: '/views/academic/imagebank/fruits', mu: 3 },
  'fruit': { path: '/views/academic/imagebank/fruits', mu: 3 },
  'vegetables': { path: '/views/academic/imagebank/vegetables', mu: 4 },
  'vegetable': { path: '/views/academic/imagebank/vegetables', mu: 4 },
  'plants': { path: '/views/academic/imagebank/plants', mu: 5 },
  'plant': { path: '/views/academic/imagebank/plants', mu: 5 },
  'insects': { path: '/views/academic/imagebank/insects', mu: 6 },
  'insect': { path: '/views/academic/imagebank/insects', mu: 6 },
  'professions': { path: '/views/academic/imagebank/professions', mu: 7 },
  'comics': { path: '/views/sections/comics', mu: 8 },
  'rhymes': { path: '/views/sections/rhymes', mu: 1 },
  'stories': { path: '/views/sections/pictorial-stories', mu: 2 },
  'festivals': { path: '/views/sections/imagebank/festivals', mu: 0 },
  'vehicles': { path: '/views/sections/imagebank/vehicles', mu: 0 },
  'puzzles': { path: '/views/sections/puzzles-riddles', mu: 0 },
};

const SUBJECT_MU: Record<string, number> = {
  'english': 0, 'eng': 0,
  'hindi': 1,
  'telugu': 2,
  'evs': 3, 'science': 3, 'sci': 3,
  'maths': 4, 'math': 4, 'mathematics': 4,
  'gk': 5, 'general knowledge': 5,
  'computer': 6, 'computers': 6, 'it': 6,
  'art': 7, 'drawing': 7,
  'craft': 8, 'crafts': 8,
  'stories': 9, 'story': 9,
  'charts': 10, 'chart': 10,
};

const AGE_TO_CLASS: Record<number, string> = {
  3: 'nursery', 4: 'lkg', 5: 'ukg',
  6: 'class-1', 7: 'class-2', 8: 'class-3', 9: 'class-4', 10: 'class-5',
  11: 'class-6', 12: 'class-7', 13: 'class-8', 14: 'class-9', 15: 'class-10',
};

interface PortalResult {
  path: string; 
  title: string; 
  category: string; 
  thumbnail: string; 
  type: string; 
  tags: string[];
  code?: string;
}

// Check if a result is an actual image (has valid thumbnail URL)
function isValidImageResult(result: PortalResult): boolean {
  if (!result.thumbnail) return false;
  
  const isImageUrl = result.thumbnail.includes('.jpg') || 
                     result.thumbnail.includes('.jpeg') || 
                     result.thumbnail.includes('.png') || 
                     result.thumbnail.includes('.gif') ||
                     result.thumbnail.includes('.webp') ||
                     result.thumbnail.includes('r2.dev');
  
  const isNotCategory = !['Academic', 'Edutainment', 'Section', 'Category'].includes(result.title);
  
  return isImageUrl && isNotCategory;
}

// Direct portal API call - returns only valid image results (limited to requested size)
async function fetchPortalResultsDirect(query: string, size: number = CHATBOT_RESULTS_LIMIT): Promise<PortalResult[]> {
  try {
    console.log(`🔍 [PORTAL] Fetching: "${query}" (size: ${size})`);
    const url = `${PORTAL_API}?query=${encodeURIComponent(query)}&size=${size + 5}`; // Fetch extra to filter
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`⚠️ [PORTAL] API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      console.log(`⚠️ [PORTAL] No results for "${query}"`);
      return [];
    }
    
    // Filter to only include valid image results and limit to requested size
    const validResults = data.results
      .filter((r: PortalResult) => isValidImageResult(r))
      .slice(0, size);
    
    console.log(`✅ [PORTAL] Found ${validResults.length} valid images for "${query}"`);
    return validResults;
  } catch (error) {
    console.error('❌ [PORTAL] Error:', error);
    return [];
  }
}

// Greeting patterns
const GREETING_PATTERNS = [/^(hi|hello|hey|hii+|helo|hai|hola)\b/i, /^good\s*(morning|afternoon|evening)/i, /^(what'?s?\s*up|howdy|greetings|namaste)/i];

function isGreeting(message: string): boolean {
  return GREETING_PATTERNS.some(p => p.test(message.trim().toLowerCase()));
}

function findSubjectMu(query: string): number | null {
  const lowerQuery = query.toLowerCase();
  for (const [subj, mu] of Object.entries(SUBJECT_MU)) {
    if (lowerQuery.includes(subj)) return mu;
  }
  return null;
}

function parseClassSubject(query: string): { classNum: number | null; subjectMu: number | null } {
  const classMatch = query.toLowerCase().match(/(?:class|grade|standard)\s*(\d+)/i);
  const subjectMu = findSubjectMu(query);
  return {
    classNum: classMatch ? parseInt(classMatch[1]) : null,
    subjectMu
  };
}

function parseAge(query: string): number | null {
  const ageMatch = query.toLowerCase().match(/(?:age|year|years?\s*old)\s*(\d+)/i) || query.match(/(\d+)\s*(?:year|years?\s*old)/i);
  return ageMatch ? parseInt(ageMatch[1]) : null;
}

function buildSmartUrl(query: string, classNum: number | null, subjectMu: number | null): string {
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

export const appRouter = router({
  chatbot: router({
    autocomplete: publicProcedure
      .input(z.object({ query: z.string(), language: z.string().optional() }))
      .query(async ({ input }) => {
        if (input.query.length < 2) return { resources: [], images: [] };
        try {
          const portalResults = await fetchPortalResultsDirect(input.query, CHATBOT_RESULTS_LIMIT);
          
          const images = portalResults.map((r: PortalResult) => ({
            id: r.code || r.title, 
            url: r.thumbnail || r.path, 
            title: r.title, 
            category: r.category,
          }));
          
          const { classNum, subjectMu } = parseClassSubject(input.query);
          const url = buildSmartUrl(input.query, classNum, subjectMu);
          
          const resources = portalResults.length > 0 ? [{
            name: `Browse: "${input.query}"`, 
            description: `Showing top ${portalResults.length} results`, 
            url: url,
          }] : [];
          
          return { resources, images };
        } catch (error) {
          console.error("Autocomplete error:", error);
          return { resources: [], images: [] };
        }
      }),

    chat: publicProcedure
      .input(z.object({
        message: z.string(), 
        sessionId: z.string(), 
        language: z.string().optional(),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
      }))
      .mutation(async ({ input }) => {
        const { message, sessionId, language = "en", history = [] } = input;
        console.log(`\n🎯 === SEARCH START: "${message}" ===`);

        // Greeting check
        if (isGreeting(message)) {
          console.log(`👋 Greeting detected`);
          let aiMessage = "Hello! I'm your MySchool Assistant. How can I help you find educational resources today?";
          try { const r = await getAIResponse(message, history); if (r.message) aiMessage = r.message; } catch (e) {}
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

        // Translation if needed
        let searchQuery = message;
        if (language && language !== "en") {
          try { 
            const r = await translateAndExtractKeyword(message, language); 
            searchQuery = r.translated || message; 
          } catch (e) {}
        }

        // Parse class/subject
        const { classNum, subjectMu } = parseClassSubject(searchQuery);

        // Build URL that will show ALL results when clicked
        const resourceUrl = buildSmartUrl(searchQuery, classNum, subjectMu);
        console.log(`🔗 Resource URL: ${resourceUrl}`);

        // Fetch top 5 results only
        let portalResults = await fetchPortalResultsDirect(searchQuery, CHATBOT_RESULTS_LIMIT);
        
        // Check if we have valid image results
        const hasRealResults = portalResults.length > 0;
        
        // Build response
        let responseMessage: string;
        let thumbnails: Array<{url: string; thumbnail: string; title: string; category: string}> = [];
        let resourceName: string = "";
        let resourceDescription: string = "";
        let searchType: string;
        
        if (hasRealResults) {
          thumbnails = portalResults.map(r => ({ 
            url: r.path, 
            thumbnail: r.thumbnail, 
            title: r.title, 
            category: r.category 
          }));
          
          // Simple message: "Showing top X results for search"
          responseMessage = `Showing top ${portalResults.length} results for "${searchQuery}". Click "Open Resource" to see all matching images!`;
          resourceName = `Top ${portalResults.length} results`;
          resourceDescription = portalResults.slice(0, 3).map(r => r.title).join(", ");
          searchType = "direct_search";
        } else {
          // No valid image results found
          responseMessage = `No images found for "${searchQuery}". Try searching for:\n• Common topics like "animals", "fruits", "flowers"\n• Class-based content like "Class 5 Maths"\n• Or browse our resource categories!`;
          resourceName = "";
          resourceDescription = "";
          searchType = "no_results";
          thumbnails = [];
        }

        await saveChatMessage({ sessionId, role: "user", message, language });
        await saveChatMessage({ sessionId, role: "assistant", message: responseMessage, language: "en" });
        await logSearchQuery({ 
          sessionId, 
          query: searchQuery, 
          translatedQuery: searchQuery !== message ? searchQuery : null, 
          language, 
          resultsCount: thumbnails.length, 
          topResultUrl: resourceUrl, 
          topResultName: portalResults[0]?.title || "" 
        });

        console.log(`✅ === SEARCH COMPLETE (${hasRealResults ? `showing ${portalResults.length}` : 'no results'}) ===\n`);
        
        return { 
          response: responseMessage, 
          resourceUrl: hasRealResults ? resourceUrl : "", 
          resourceName,
          resourceDescription, 
          suggestions: hasRealResults ? [] : ["Animals", "Class 5 English", "Flowers", "Fruits"], 
          searchType, 
          thumbnails 
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
