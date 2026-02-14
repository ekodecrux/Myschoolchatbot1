# MySchool Chatbot - Business Requirements Document

**Version:** 1.0  
**Date:** January 22, 2026  
**Product:** MySchool Assistant Chatbot  
**Domain:** https://myschoolchatbot.in | https://demo.myschoolchatbot.in

---

## 1. Overview

An intelligent chatbot assistant for portal.myschoolct.com that helps students and teachers quickly find educational resources through natural language queries.

---

## 2. Functional Requirements

### 2.1 Search Functionality

| Req ID | Requirement | Expected Result |
|--------|-------------|-----------------|
| SR-01 | Image/Visual searches (animals, flowers, etc.) | Redirects to Image Bank with search param |
| SR-02 | One Click Resource exact matches (MCQ Bank, Smart Wall) | Redirects to specific resource URL |
| SR-03 | Class + Subject queries (e.g., "class 5 maths") | Redirects to class page with subject filter |
| SR-04 | Class only queries (e.g., "class 3") | Redirects to class resources page |
| SR-05 | General text searches (e.g., "telugu poems") | Redirects to portal search results page |
| SR-06 | No match / gibberish queries | Shows fallback message with academic browse link |

### 2.2 Interactive Responses

| Req ID | Requirement | Expected Result |
|--------|-------------|-----------------|
| IR-01 | Greeting messages (hi, hello, hey) | Returns friendly greeting with 4 suggested searches |
| IR-02 | Help requests | Returns feature list with examples |
| IR-03 | Thank you messages | Returns acknowledgment with follow-up suggestions |

### 2.3 Search Intelligence

| Req ID | Requirement | Expected Result |
|--------|-------------|-----------------|
| SI-01 | Fuzzy matching | Handles typos and partial matches |
| SI-02 | Phonetic matching (Soundex) | Matches similar-sounding words |
| SI-03 | Multi-language support | Translates non-English queries before search |

---

## 3. UI/UX Requirements

| Req ID | Requirement | Expected Result |
|--------|-------------|-----------------|
| UX-01 | Sticky header | Header remains fixed; chat area scrolls independently |
| UX-02 | Single portal reference | "portal.myschoolct.com" appears only in subtitle |
| UX-03 | No background layer | Full-screen chatbot without outer container |
| UX-04 | Distinct images only | Autocomplete shows unique images (no duplicates) |
| UX-05 | Image padding | Images have left margin (not touching border) |
| UX-06 | Voice input | Mic button enabled for voice queries |

---

## 4. Search Priority Order

1. **Image Bank** - Visual terms (animals, flowers, shapes, colors)
2. **One Click Resources** - Exact resource matches (MCQ Bank, Smart Wall, Exam Tips)
3. **Academic/Class** - Class + subject combinations
4. **General Search** - Portal search results page
5. **Fallback** - Academic browse page

---

## 5. Sample Test Cases

| Input | Expected Behavior |
|-------|-------------------|
| "animals" | Image Bank search for animals |
| "lion" | Image Bank search for lion |
| "class 5 maths" | Class 5 Maths curriculum page |
| "class 3" | Class 3 resources page |
| "telugu poems" | Portal search results for "telugu poems" |
| "smart wall" | Smart Wall resource page |
| "hello" | Interactive greeting with suggestions |
| "xyzabc" | Fallback to academic browse |

---

## 6. Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | React + TypeScript + Tailwind CSS |
| Backend | Node.js + tRPC |
| Database | MySQL (Drizzle ORM) |
| Deployment | PM2 + Nginx + Let's Encrypt SSL |
| Server | Ubuntu on 88.222.244.84 |

---

## 7. Deployment URLs

| Environment | URL |
|-------------|-----|
| Production | https://myschoolchatbot.in |
| Demo | https://demo.myschoolchatbot.in |
| Repository | github.com/ekodecrux/myschool-chatbot4 |

---

*Document End*
