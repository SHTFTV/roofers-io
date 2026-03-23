const TRADE_DOMAINS: Record<string, string> = {
  "Drywall": "Drywallers.io",
  "Drywalling": "Drywallers.io",
  "Gas Fitting": "GasFitters.io",
  "Gasfitting": "GasFitters.io",
  "Plumbing": "Plumbers.ltd",
  "Electrical": "Sparkys.tv",
  "HVACR": "HVACR.tv",
  "HVAC": "HVACR.tv",
  "Framing": "Framers.io",
  "Hardscapes": "Hardscapes.io",
  "Hardscaping": "Hardscapes.io",
  "Fabrication": "Fabricators.io",
  "Metal Fabrication": "Fabricators.io",
  "Snow Plowing": "PlowWow",
  "Plowing": "PlowWow",
  "General": "Estimators.io",
};

const TRADE_NETWORKS: Record<string, string> = {
  "Drywall": "SteelStud & Drywallers.io",
  "Drywalling": "SteelStud & Drywallers.io",
  "Gas Fitting": "GasFitters.io",
  "Gasfitting": "GasFitters.io",
  "Plumbing": "Plumbers.ltd",
  "Electrical": "Sparkys.tv",
  "HVACR": "HVACR.tv",
  "HVAC": "HVACR.tv",
  "Framing": "Framers.io",
  "Hardscapes": "Hardscapes.io",
  "Hardscaping": "Hardscapes.io",
  "Fabrication": "Fabricators.io",
  "Metal Fabrication": "Fabricators.io",
  "Snow Plowing": "PlowWow",
  "Plowing": "PlowWow",
  "General": "Estimators.io",
};

const TRADE_EXAMPLES: Record<string, string> = {
  "Drywall": "'Boarding a basement in Cloverdale. Level 4 finish.'",
  "Drywalling": "'Boarding a basement in Cloverdale. Level 4 finish.'",
  "Gas Fitting": "'Installed a 96% Navien combi unit. New gas line run from meter.'",
  "Gasfitting": "'Installed a 96% Navien combi unit. New gas line run from meter.'",
  "Plumbing": "'Kitchen rough-in complete. All copper with ProPress fittings.'",
  "Electrical": "'200A panel upgrade with whole-home surge protection.'",
  "HVACR": "'Commercial rooftop unit swap. 5-ton Carrier with VFD.'",
  "HVAC": "'Commercial rooftop unit swap. 5-ton Carrier with VFD.'",
  "Framing": "'Second floor framing complete. 2x10 joists 16 OC, hurricane ties installed.'",
  "Hardscapes": "'Paver patio with soldier course border. 4\" compacted base.'",
  "Hardscaping": "'Paver patio with soldier course border. 4\" compacted base.'",
  "Fabrication": "'Custom steel staircase. 3/16 plate treads, powder coated black.'",
  "Metal Fabrication": "'Custom steel staircase. 3/16 plate treads, powder coated black.'",
  "Snow Plowing": "'Cleared the Costco lot. 6\" accumulation, salted all entrances.'",
  "Plowing": "'Cleared the Costco lot. 6\" accumulation, salted all entrances.'",
  "General": "'Job site photo — quality work completed today.'",
};

const PROVINCE_CODES: Record<string, string> = {
  "British Columbia": "BC",
  "Alberta": "AB",
  "Ontario": "ON",
  "Quebec": "QC",
  "Manitoba": "MB",
  "Saskatchewan": "SK",
  "Nova Scotia": "NS",
  "New Brunswick": "NB",
};

function getProvinceCode(province: string): string {
  return PROVINCE_CODES[province] || province;
}

export function generateWelcomeMessage(contractor: {
  name: string;
  trade: string;
  city: string;
  province: string;
  country: string;
}): string {
  const { name, trade, city, province } = contractor;
  const network = TRADE_NETWORKS[trade] || `${trade} Network`;
  const domain = TRADE_DOMAINS[trade] || "Estimators.io";
  const example = TRADE_EXAMPLES[trade] || `'Quality ${trade.toLowerCase()} work completed on site.'`;
  const provCode = getProvinceCode(province);
  const firstName = name.split(" ")[0] || "there";

  return `Welcome to the ${network} Network! 🚀

Hey ${firstName} — you are now verified for ${city}, ${provCode}.

📸 *How to post:*
Whenever you're on a job site, just send a photo to this chat with a quick caption like: ${example}

🤖 *What happens next:*
Our AI "EyeSpyR" system will instantly turn your snap into a 1,200-word project page on ${domain}, giving you local SEO authority and fresh leads.

📊 *Monthly EyeSpyR Performance Report:*
Starting the 1st of next month, you'll receive your monthly report at 8:00 AM covering:

• *Empire Health* — Growth and freshness across all your city hubs
• *Silo Battleground* — Which regions are winning and where to push harder
• *Competitor Leakage* — Who's trying to take your rank and how we're defending
• *Lead Attribution* — How many homeowners are flowing through to your business

🔒 No logins. No passwords. Just Snap & Post.

Every photo you send is a brick in your SEO moat. The more bricks you send, the harder it is for anyone to knock you off the #1 spot in ${provCode}.

Ask me to edit or delete any scheduled action at any time. Ready when you are — send your first snap! 📷`;
}

export function generatePostConfirmation(params: {
  aiTitle: string;
  trade: string;
  citySlug: string;
  postNumber: number;
}): string {
  const { aiTitle, trade, citySlug, postNumber } = params;
  const domain = TRADE_DOMAINS[trade] || "estimators.io";

  const milestone = postNumber === 1
    ? "\n\n🎉 That's your first post! Your SEO journey starts now."
    : postNumber === 10
    ? "\n\n🏆 10 posts! You're building serious local authority."
    : postNumber === 25
    ? "\n\n⚡ 25 posts! You're dominating your city pages."
    : postNumber === 50
    ? "\n\n🔥 50 posts! Your SEO moat is getting deep."
    : postNumber === 100
    ? "\n\n👑 100 POSTS! You are the undisputed #1 in your territory."
    : "";

  return `✅ Post published!

"${aiTitle}" is now live on ${domain}/${citySlug}

📈 Post #${postNumber} for your profile.${milestone}

Keep snapping — every photo strengthens your rank. 📷`;
}
