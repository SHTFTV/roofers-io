import { openai } from "@workspace/integrations-openai-ai-server";

export async function generateSEOPost(params: {
  caption: string;
  trade: string;
  city: string;
  province: string;
  country: string;
}): Promise<{
  title: string;
  content: string;
  metaDescription: string;
  keywords: string[];
}> {
  const { caption, trade, city, province, country } = params;

  const regionContext = country === "CA"
    ? `Canadian province of ${province}. Reference the National Building Code of Canada (NBC 2020) and applicable provincial codes.`
    : country === "US"
    ? `US state of ${province}. Reference the International Building Code (IBC) and applicable state codes.`
    : country === "UK"
    ? `United Kingdom region of ${province}. Reference UK Building Regulations.`
    : country === "AU"
    ? `Australian state of ${province}. Reference the National Construction Code (NCC).`
    : `${province}, ${country}. Reference applicable local building codes.`;

  const prompt = `Role: You are a Senior Construction Technical Writer and Local SEO Expert specializing in ${trade} services.

Task: Write an SEO-optimized blog post based on a contractor's job photo caption.

Contractor Caption: "${caption}"
Trade: ${trade}
City: ${city}
Region: ${regionContext}

Requirements:
1. Write a compelling, keyword-rich title (under 60 characters) targeting "${trade} in ${city}"
2. Write a 400-600 word SEO article that:
   - Opens with a hook about ${trade} work in ${city}
   - Describes the work shown in the contractor's caption with technical detail
   - References applicable building codes and standards for ${province}
   - Mentions the city/neighborhood naturally 3-5 times for local SEO
   - Includes a call to action for ${city} residents needing ${trade} services
   - Uses professional but accessible language
3. Write a meta description (under 160 characters)
4. Suggest 5-8 SEO keywords

Respond in JSON format:
{
  "title": "...",
  "content": "...",
  "metaDescription": "...",
  "keywords": ["..."]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return {
      title: parsed.title || `${trade} Services in ${city}`,
      content: parsed.content || "",
      metaDescription: parsed.metaDescription || `Professional ${trade} services in ${city}, ${province}`,
      keywords: parsed.keywords || [trade.toLowerCase(), city.toLowerCase()],
    };
  } catch (error) {
    console.error("AI content generation failed:", error);
    return {
      title: `${trade} Services in ${city}`,
      content: `Professional ${trade} work completed in ${city}, ${province}. ${caption}`,
      metaDescription: `Professional ${trade} services in ${city}, ${province}. Quality workmanship guaranteed.`,
      keywords: [trade.toLowerCase(), city.toLowerCase(), province.toLowerCase()],
    };
  }
}
