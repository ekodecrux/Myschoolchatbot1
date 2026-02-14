import { Router } from 'express';

const getRelevantImages = (query: string) => {
    if (query.toLowerCase().includes('monkey') || query.toLowerCase().includes('lion')) {
        return [
            {
                title: "Lion Story - Page 1",
                url: "https://portal.myschoolct.com/resource/lion-story-p1",
                thumbnailUrl: "https://portal.myschoolct.com/assets/thumbnails/lion_story_p1.jpg"
            },
            {
                title: "Monkey & Cap Seller",
                url: "https://portal.myschoolct.com/resource/monkey-cap-seller",
                thumbnailUrl: "https://portal.myschoolct.com/assets/thumbnails/monkey_cap_seller.jpg"
            },
            {
                title: "Colouring The Lion",
                url: "https://portal.myschoolct.com/resource/colouring-lion",
                thumbnailUrl: "https://portal.myschoolct.com/assets/thumbnails/colouring_lion.jpg"
            },
            {
                title: "Pact with the Lion",
                url: "https://portal.myschoolct.com/resource/pact-lion",
                thumbnailUrl: "https://portal.myschoolct.com/assets/thumbnails/pact_lion.jpg"
            },
        ];
    }
    return [];
};

const autocompleteApi = (req: any, res: any) => {
    const { query } = req.query;

    const mainSuggestions: any[] = [];
    const imageSuggestions = getRelevantImages(query);

    res.json({
        mainSuggestions: mainSuggestions,
        imageSuggestions: imageSuggestions
    });
};

const router = Router();
router.get('/autocomplete', autocompleteApi);

export const registerDirectChatRoute = (app: any) => {
    app.use('/api/chat', router);
};
