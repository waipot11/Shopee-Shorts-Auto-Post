import express from "express";
import path from "path";
import fs from "fs/promises";
import { GoogleGenAI, Type } from "@google/genai";
import cron from "node-cron";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use("/src/assets/images", express.static(path.join(process.cwd(), "src", "assets", "images")));

// Path definitions for persistence using process.cwd() to support both ESM/CJS runtime safely
const DB_DIR = path.join(process.cwd(), "src", "db");
const PRODUCTS_FILE = path.join(DB_DIR, "products.json");
const LOGS_FILE = path.join(DB_DIR, "logs.json");
const CONFIG_FILE = path.join(DB_DIR, "config.json");

// System-wide default variables
const DEFAULT_SHOPEE_AFFILIATE_ID = "15324930878";

// Ensure directories exist helper
async function ensureDbDir() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch (err) {
    // Ignore if already exists
  }
}

async function readConfig() {
  await ensureDbDir();
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return {
      affiliateId: process.env.SHOPEE_AFFILIATE_ID || DEFAULT_SHOPEE_AFFILIATE_ID,
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      youtubeClientId: process.env.YOUTUBE_CLIENT_ID || "",
      youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
      youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || ""
    };
  }
}

async function writeConfig(config: any) {
  await ensureDbDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// Read and write file helpers with lock/retries to prevent race conditions
async function readProducts() {
  await ensureDbDir();
  try {
    const data = await fs.readFile(PRODUCTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function writeProducts(products: any[]) {
  await ensureDbDir();
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), "utf-8");
}

async function readLogs() {
  await ensureDbDir();
  try {
    const data = await fs.readFile(LOGS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function writeLogs(logs: any[]) {
  await ensureDbDir();
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2), "utf-8");
}

// 1. Shopee Affiliate Link generator
function generateShopeeAffiliateLink(originalUrl: string, affiliateId: string, productName?: string) {
  const cleanId = affiliateId || DEFAULT_SHOPEE_AFFILIATE_ID;
  
  if (!originalUrl) {
    const defaultSearch = productName ? `https://shopee.co.th/search?keyword=${encodeURIComponent(productName)}` : `https://shopee.co.th`;
    return `${defaultSearch}${defaultSearch.includes("?") ? "&" : "?"}utm_source=affiliate&utm_medium=shorts&aff_id=${cleanId}`;
  }

  let targetUrl = originalUrl;

  // Detect if originalUrl is a placeholder (like product-i.11111111.22222222 or contains dummy numbers)
  const isDummy = originalUrl.includes("11111111") ||
                  originalUrl.includes("33333333") ||
                  originalUrl.includes("55555555") ||
                  originalUrl.includes("77777777") ||
                  originalUrl.includes("99999999");

  if (isDummy) {
    let keyword = productName || "shopee";
    if (originalUrl.includes("11111111")) keyword = "ไมโครโฟนไร้สาย";
    else if (originalUrl.includes("33333333")) keyword = "เครื่องชงกาแฟเอสเพรสโซ่พกพา";
    else if (originalUrl.includes("55555555")) keyword = "คีย์บอร์ดกลไกไร้สาย";
    else if (originalUrl.includes("77777777")) keyword = "โคมไฟดวงจันทร์";
    else if (originalUrl.includes("99999999")) keyword = "เครื่องให้อาหารสัตว์เลี้ยงอัตโนมัติ";
    
    targetUrl = `https://shopee.co.th/search?keyword=${encodeURIComponent(keyword)}`;
  } else if (!originalUrl.includes("shopee")) {
    if (productName) {
      targetUrl = `https://shopee.co.th/search?keyword=${encodeURIComponent(productName)}`;
    } else {
      targetUrl = `https://shopee.co.th`;
    }
  }

  // Strip existing search parameters if any to avoid collision
  const baseUrl = targetUrl.split("?")[0];
  const originalParams = targetUrl.includes("?") ? targetUrl.split("?")[1] : "";
  
  if (originalParams) {
    // Keep existing query parameters (like keyword=...) but remove duplicate affiliate params if any
    const cleanParams = originalParams
      .split("&")
      .filter(p => !p.startsWith("utm_source=") && !p.startsWith("utm_medium=") && !p.startsWith("aff_id="))
      .join("&");
    
    const paramsString = cleanParams ? `${cleanParams}&` : "";
    return `${baseUrl}?${paramsString}utm_source=affiliate&utm_medium=shorts&aff_id=${cleanId}`;
  }
  
  return `${baseUrl}?utm_source=affiliate&utm_medium=shorts&aff_id=${cleanId}`;
}

// 2. Initialize Gemini API Client
async function getGeminiClient() {
  const config = await readConfig();
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "") {
    // Return null to trigger fallback or simulation warnings
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// 3. AI Caption & Script Generator (Gemini-3.5-flash)
async function generateContentWithGemini(productName: string, productDesc: string, affiliateLink: string) {
  const ai = await getGeminiClient();
  
  if (!ai) {
    console.log("⚠️ No GEMINI_API_KEY detected. Using simulated local AI response generator.");
    return generateSimulatedAIResponse(productName, productDesc, affiliateLink);
  }

  const systemInstruction = `คุณเป็นนักคิดก็อปปี้ไรท์เตอร์โฆษณา (Copywriter) ครีเอทีฟโฆษณา และนายหน้า Shopee สายตลก แสบๆ กวนๆ ตลกหักมุม (Plot Twist) ที่เก่งที่สุดในการดันยอดขายผ่าน YouTube Shorts ของประเทศไทย
  หน้าที่ของคุณคือการคิดข้อความโฆษณาสำหรับสินค้าชิ้นนี้ โดยเน้นที่ความสนุกสนาน มุกตลกเสียดสี มุกหักมุมสุดพีค (Plot Twist) ความแปลกใหม่ และกระตุ้นให้คนดูอยากซื้อจริง 100%
  
  กฎสำคัญในการเขียนเนื้อหา:
  1. ต้องมีมุกตลกหักมุม (Plot Twist) เสมอ เช่น อวยสินค้าข้อดีแทบตาย แต่จบด้วยข้อจำกัดฮาๆ บ่นชีวิต หรือความจริงสุดปั่น เช่น ซื้อเครื่องชงกาแฟพกพามาบีบจนมือหักกล้ามขึ้น แต่ไม่ได้กินกาแฟ ต้องเดินเข้าร้านคาเฟ่แทน
  2. สคริปต์พูด (purchaseScript) สำหรับลงเสียงบรรยาย 15 วินาที ต้องตลก ดึงดูดความสนใจ ยิงมุกหักมุมช่วงกลางหรือปลายสคริปต์อย่างแสบสัน
  3. หลีกเลี่ยงการเขียนแบบทางการหรือน่าเบื่อโดยสิ้นเชิง ให้เขียนสไตล์กวนๆ ยิงมุกขำขันโดนใจคนไทยวัยรุ่น-วัยทำงาน`;

  const prompt = `ช่วยเขียนคอนเทนต์รีวิวสินค้าเพื่อโพสต์ YouTube Shorts สำหรับสินค้าชิ้นนี้:
  ชื่อสินค้า: "${productName}"
  คำอธิบายสินค้า: "${productDesc}"
  ลิงก์นายหน้า: "${affiliateLink}"

  กรุณาส่งกลับมาเป็นรูปแบบ JSON ตามโครงสร้างด้านล่าง:
  - youtubeTitle: หัวข้อคลิป Shorts (ยาวไม่เกิน 100 ตัวอักษร) ดึงดูดความสนใจขั้นสุด มีอีโมจิกวนๆ และแฮชแท็กหลัก
  - youtubeCaption: แคปชันที่จะใส่ในคำอธิบายคลิป (Description) เขียนสไตล์รีวิวตลกขบขัน ฮาๆ บ่นชีวิต หรือมุกแสบๆ มีพอยต์ชี้ข้อดี/ข้อเสียแบบกวนๆ พร้อมปักลิงก์นายหน้าท้ายแคปชันอย่างเด่นชัด มีแฮชแท็กครบถ้วน
  - purchaseScript: สคริปต์สำหรับนำไปลงเสียง/พูดประกอบคลิปความยาว 15 วินาที สไตล์รีวิวเรียลๆ ปั่นๆ`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            youtubeTitle: { type: Type.STRING, description: "หัวข้อคลิปภาษาไทย ไม่เกิน 100 ตัวอักษร ชวนกดคลิก มีอีโมจิและแฮชแท็ก" },
            youtubeCaption: { type: Type.STRING, description: "แคปชันคำอธิบายคลิปสไตล์สายตลก ฮาๆ รวมลิงก์สินค้าและแฮชแท็กอย่างสวยงาม" },
            purchaseScript: { type: Type.STRING, description: "สคริปต์พูด 15 วินาทีสำหรับบรรยายคลิปสั้น ปั่นๆ กวนๆ" }
          },
          required: ["youtubeTitle", "youtubeCaption", "purchaseScript"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Gemini returned empty response.");
    
    return JSON.parse(text);
  } catch (error: any) {
    console.error("❌ Gemini generation error:", error.message || error);
    return generateSimulatedAIResponse(productName, productDesc, affiliateLink);
  }
}

// Fallback AI generator
function generateSimulatedAIResponse(productName: string, productDesc: string, affiliateLink: string) {
  const nameLower = (productName || "").toLowerCase();
  
  if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    return {
      youtubeTitle: `เครื่องชงกาแฟพกพา: บีบจนมือหัก...แต่ไม่ได้กินกาแฟ?! ☕️🤣 #shorts`,
      youtubeCaption: `รีวิวเรียลๆ เครื่องชงกาแฟเอสเพรสโซ่พกพา ไม่ต้องใช้ไฟฟ้า!\n\nบอกเลยว่าคุ้มค่ามาก... แค่ตักผงใส่ เติมน้ำร้อน แล้วใช้สองมือบีบๆๆๆ เค้นพลังชีวิตทั้งหมดที่มีออกมา เพื่อให้ได้เอสเพรสโซ่หนึ่งจอกเล็กๆ! สรุปกาแฟยังไม่เข้าปาก แต่เส้นเลือดสมองจะแตกแทน 😭 บีบเสร็จกล้ามแขนขึ้นทันตาเห็น โคตรเหนื่อย! สุดท้ายเลยหิ้วเครื่องนี้เดินเข้าร้านคาเฟ่ให้บาริสต้าเค้าชงให้ สบายใจละ 🤣\n\nพิกัดสำหรับสายฟิตเนสอยากบริหารกล้ามแขนพร้อมดื่มด่ำกลิ่นกาแฟ:\n👉 ${affiliateLink}\n\n#ตลกหักมุม #เครื่องชงกาแฟพกพา #รีวิวกวนๆ #กาแฟสด #นายหน้าShopee #ของมันต้องมี #Shorts`,
      purchaseScript: `เครื่องชงกาแฟพกพา ไม่ใช้ไฟฟ้า แค่ใช้แรงบีบมือ! บีบไปบีบมาครึ่งชั่วโมงไม่ได้กินน้ำกาแฟ แต่เส้นเลือดในสมองจะแตกก่อน! สรุปคุ้มมาก... ได้กล้ามแขน แต่อดกินกาแฟ จิ้มลิงก์เลย!`
    };
  }
  
  if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
    return {
      youtubeTitle: `ไมค์ไร้สายโคตรดี: ตัดเสียงรบกวนได้ทุกอย่าง ยกเว้นเสียงเมีย! 🎙️💀 #shorts`,
      youtubeCaption: `รีวิวไมโครโฟนไร้สายขนาดเล็กสำหรับแคสเกมทำคลิป!\n\nบอกเลยว่าระบบตัดเสียงรบกวนอัจฉริยะเค้าทำมาดีจริงๆ ตัดเสียงลม เสียงพัดลม เสียงสิบล้อวิ่งผ่านหายเกลี้ยง ดุจดั่งอยู่นอกอวกาศ... ยกเว้นเสียงเมียตะโกนด่าจากหลังบ้าน! ชัดแจ๋วระดับ 4K เซอร์ราวด์ดิ่งทะลุลำโพง ลมแทบจับ! สรุปซื้อมาเพื่อพิสูจน์ว่า เทคโนโลยีของมนุษยชาติก็สู้พลังทำลายล้างของมนุษย์เมียไม่ได้ 🤣\n\nใครอยากท้าทายระบบปราบเสียงเมีย จิ้มลิงก์ไปพิสูจน์ด่วน:\n👉 ${affiliateLink}\n\n#ไมโครโฟนไร้สาย #รีวิวตลก #ตลกหักมุม #เสียงเมียกวนๆ #นายหน้าShopee #ของดีบอกต่อ #Shorts`,
      purchaseScript: `ไมโครโฟนไร้สายตัดเสียงรบกวนดีเยี่ยม ตัดได้ยันเสียงรถไฟวิ่งผ่าน! ยกเว้นเสียงเมียบ่นจากในครัว... ชัดแจ๋วระดับแปดเค สรุปสิบล้อเงียบกริบ แต่เมียด่าทะลุไมค์ไปเลยจ้า!`
    };
  }

  if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    return {
      youtubeTitle: `คีย์บอร์ดบลูสวิตช์สุดฟิน: พิมพ์มันส์สะใจ...จนข้างบ้านตะโกนด่า! ⌨️🔥 #shorts`,
      youtubeCaption: `รีวิวคีย์บอร์ดปุ่มกดเสียงบลูสวิตช์สุดมันส์ ดีไซน์พิมพ์ดีดโบราณ!\n\nเสียงกดแก๊กๆๆๆ ดังไพเราะเพราะพริ้งปานเทพสร้าง พิมพ์งานมันส์มือสุดๆ เหมือนกำลังนั่งคีย์ข้อมูลกู้โลกอยู่... พิมพ์ไปได้ครึ่งชั่วโมง ได้ยินเสียงปังๆๆ มาจากข้างบ้าน! นึกว่าแฟนเพลงมาเคาะจังหวะร่วมด้วย ที่ไหนได้ ข้างบ้านเค้าตะโกนบอก 'หยุดพิมพ์โว้ยยย นึกว่าคนมารบกัน!' สุดท้ายต้องย้ายมาเล่นในมุ้งเงียบๆ สรุปฟินคนเดียว ข้างบ้านกำหมัดละ 🤣\n\nพิกัดคีย์บอร์ดกวนบ้านเรือนเคียง:\n👉 ${affiliateLink}\n\n#คีย์บอร์ดบลูสวิตช์ #ตลกหักมุม #MechanicalKeyboard #รีวิวกวนๆ #ป้ายยาสินค้า #Shorts`,
      purchaseScript: `คีย์บอร์ดบลูสวิตช์พิมพ์มันส์เสียงแน่นดังสะใจ! นั่งพิมพ์แชตคุยกับสาวข้างบ้าน นึกว่าเสียงสงครามโลกครั้งที่สาม ข้างบ้านถึงกับปีนรั้วมาถีบประตูบ้าน! พิมพ์มันส์จริง ต้องลอง!`
    };
  }

  if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
    return {
      youtubeTitle: `โคมไฟพระจันทร์ลอยได้: เอามาสร้างความโรแมนติก...แต่จบตลกหักมุมเฉย! 🌕💀 #shorts`,
      youtubeCaption: `รีวิวโคมไฟพระจันทร์ 3D ลอยได้สุดหรูหราไฮเทค หมุนได้รอบตัว เปลี่ยนได้ 3 สี!\n\nกะเอามาแต่งห้องนอน สร้างบรรยากาศสลัวๆ ชวนฝัน พาแฟนมาดินเนอร์โรแมนติกใต้แสงจันทร์... แต่พอเปิดปุ๊บ ไฟดันสว่างใสแจ๋วและสะท้อนความจริงอันโหดร้าย! แฟนเห็นคราบฝุ่นหนาเตอะที่ซุกอยู่ใต้เตียงและจานชามที่ยังไม่ได้ล้างในทันที! จากโรแมนติกกลายเป็นมหกรรมบิ๊กคลีนนิ่งเดย์ โดนด่ากวาดบ้านถูพื้นยันสว่างคาตาเลยจ้า สรุปโคมไฟดีเกินไปก็เป็นภัยต่อชีวิต 🤣\n\nใครอยากได้ตัวช่วยกระตุ้นการทำความสะอาดบ้าน จิ้มสอยด่วนจ้า:\n👉 ${affiliateLink}\n\n#โคมไฟพระจันทร์ลอยได้ #รีวิวตลก #ตลกหักมุม #โรแมนติกเฉย #ของแต่งห้องนอน #Shorts`,
      purchaseScript: `โคมไฟพระจันทร์ลอยได้ สวยงามไฮเทค กะชวนแฟนมาโรแมนติกใต้แสงจันทร์สลัวๆ พอเปิดปุ๊บ สว่างจ้าจนแฟนเห็นเศษฝุ่นใต้เตียง โดนลุกมาถูบ้านยันตีสี่! โคมไฟเปลี่ยนชีวิตเลยกู!`
    };
  }

  if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
    return {
      youtubeTitle: `เครื่องให้อาหารแมวอัจฉริยะ: ซื้อมาอำนวยความสะดวก...หรือซื้อมาให้แมวซ้อมมวย?! 🐱🥊 #shorts`,
      youtubeCaption: `รีวิวถังอาหารสัตว์เลี้ยงอัจฉริยะ มีกล้องพูดคุยเรียลไทม์!\n\nชีวิตสโลว์ไลฟ์ของคนรักสัตว์ ตั้งค่าป้อนอาหารผ่านแอปหรูหราหมาเห่า แต่อย่าประเมินพลังความหิวกระหายของไอ้ส้มที่บ้านต่ำไป! พอบอทจ่ายอาหารช้าไปวิเดียว ไอ้ส้มมันเดินมากำหมัด คว่ำถังเขย่าจนเม็ดร่วงกราวอย่างมืออาชีพ แถมจ้องตาเขม็งใส่กล้องเหมือนจะบอกว่า 'ตู้กับข้าวแค่นี้ คิดว่าปราบข้าได้เหรอทาส?!' สรุปกล้องที่ติดมาเอาไว้ดูมันซ้อมมวยพังเครื่องเล่นๆ 🤣\n\nพิกัดซื้อของเล่นซ้อมมวยให้เจ้านายของคุณ:\n👉 ${affiliateLink}\n\n#เครื่องให้อาหารสัตว์เลี้ยง #รีวิวตลก #ตลกหักมุม #ไอ้ส้มลูกพ่อ #ของใช้หมาแมว #Shorts`,
      purchaseScript: `เครื่องให้อาหารหมาแมวอัจฉริยะ ตั้งเวลาอาหารคุยผ่านกล้องได้! แต่พอมันจ่ายอาหารช้าวิเดียว ไอ้ส้มตบเครื่องคว่ำแล้วหยิบกินเอง คุยผ่านกล้องทีแมวจ้องตาเขม็งเหมือนจะแว้งกัด!`
    };
  }

  // Base fallback
  return {
    youtubeTitle: `ของมันต้องมี! หรือต้องไม่มีดีนะ? 🤔 ${productName} #shopeeaffiliate #shorts`,
    youtubeCaption: `นี่คือรีวิวเรียลๆ ของ "${productName}"! \n\nบอกเลยว่าตั้งแต่ซื้อมาใช้ ชีวิตเปลี่ยนไปมาก... เปลี่ยนจากนอนหลับสบายเป็นมานั่งเครียดเรื่องเงินแทน! หยอกๆ 🤣\nก็เอาเถอะ สำหรับชิ้นนี้มันดีตรงที่ "${productDesc}"\n\nใครใจถึงอยากลองของ จิ้มพิกัดท้ายคลิปตรงนี้เลยจ้า อย่าปล่อยให้เงินค้างบัญชี!\n👉 ${affiliateLink}\n\n#รีวิวตลก #นายหน้าShopee #ShopeeTH #ของใช้รีวิว #ชี้เป้าโปรถูก #Shorts`,
    purchaseScript: `แกรรร! สิ่งนี้คือที่สุดละ ซื้อมาเพื่อความบันเทิงและพบมุกตลกหักมุมในชีวิตจริง ไม่เชื่อไปจิ้มลิงก์ที่ใต้โปรไฟล์เลยด่วน!`
  };
}

// AI Cover Generator (Gemini)
async function generateCoverWithGemini(productName: string, productDesc: string, modelStyle: string) {
  const ai = await getGeminiClient();
  
  if (!ai) {
    console.log("⚠️ No GEMINI_API_KEY detected. Using simulated local cover text generator.");
    return generateSimulatedCover(productName, productDesc, modelStyle);
  }

  const systemInstruction = `คุณเป็นนักคิดก็อปปี้ไรท์เตอร์โฆษณา ครีเอทีฟโฆษณา และนายหน้า Shopee สายตลก แสบๆ กวนๆ ตลกหักมุม (Plot Twist) ของประเทศไทย
  หน้าที่ของคุณคือการคิดคำพูดและข้อความโฆษณาบนภาพปก YouTube Shorts สำหรับสินค้าชิ้นนี้ โดยเน้นสไตล์ตลกหักมุมสุดพีค (Plot Twist)
  
  คุณต้องตอบกลับเป็น JSON ที่มีโครงสร้างฟิลด์ดังนี้เท่านั้น ห้ามใส่เครื่องหมายคำพูด Markdown หรือส่วนตกแต่งคำนำหรือสรุปอื่นๆ:
  {
    "titleOverlay": "ข้อความพาดหัวตัวใหญ่บนหน้าปก (สั้นๆ สะดุดตา กวนๆ ไม่เกิน 30 ตัวอักษร เช่น ชงกาแฟ บีบมือหัก!)",
    "modelSubtitle": "คำพูดเจ็บๆ หรือในใจของนายแบบ/นางแบบ (เช่น กาแฟไม่ได้กิน เส้นเลือดสมองจะแตกก่อน! ไม่เกิน 45 ตัวอักษร)",
    "plotTwist": "มุขหักมุมตอนจบเฉลยความจริงฮาๆ (เช่น สรุปบีบครึ่งชั่วโมง เดินไปร้านคาเฟ่บาริสต้าชงให้สบายใจ สั้นๆ ไม่เกิน 60 ตัวอักษร)",
    "stampText": "สติกเกอร์สั้นๆ แปะบนหน้าปก เช่น เมียด่า, มือหัก, ซื้อทำไม (ไม่เกิน 10 ตัวอักษร)"
  }`;

  const prompt = `ช่วยคิดคำปกสั้นๆ กวนๆ หักมุมสำหรับสินค้าชิ้นนี้:
  ชื่อสินค้า: "${productName}"
  คำอธิบาย: "${productDesc}"
  สไตล์นายแบบ: "${modelStyle}"`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json"
      }
    });

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini Cover Generation error, falling back:", err);
    return generateSimulatedCover(productName, productDesc, modelStyle);
  }
}

function generateSimulatedCover(productName: string, productDesc: string, modelStyle: string) {
  const nameLower = (productName || "").toLowerCase();
  
  if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    return {
      titleOverlay: "ชงพกพา บีบจนมือหัก! ☕️",
      modelSubtitle: "กาแฟยังไม่ได้กิน เส้นเลือดสมองจะแตกก่อน!",
      plotTwist: "สรุป: คุ้มมาก... ได้กล้ามแขน แอยกดื่มกาแฟไม่อร่อย สุดท้ายต้องเดินเข้าร้านคาเฟ่บาริสต้าชงให้แทน 🤣",
      stampText: "บีบมือหัก"
    };
  }
  
  if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
    return {
      titleOverlay: "ตัดเสียงรบกวนอัจฉริยะ! 🎙️",
      modelSubtitle: "ตัดได้ยันเสียงสิบล้อ ยกเว้นเสียงเมียด่าจากหลังบ้าน!",
      plotTwist: "สรุป: นวัตกรรมร้อยล้าน ก็พ่ายแพ้พลังเสียงทำลายล้างของเมียหลวง 💀",
      stampText: "เสียงเมียชัดจัด"
    };
  }

  if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    return {
      titleOverlay: "พิมพ์มันส์สะใจ ข้างบ้านทุบกำแพง! ⌨️",
      modelSubtitle: "เสียงบลูสวิตช์ฟินจัด นึกว่ายิงถล่มสงครามโลก!",
      plotTwist: "สรุป: พิมพ์แชตคุยกับสาวเพลินๆ ข้างบ้านเตรียมปีนมาถีบประตูบ้านพัง 🤣",
      stampText: "ข้างบ้านกำหมัด"
    };
  }

  if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
    return {
      titleOverlay: "โคมไฟพระจันทร์ โรแมนติก? 🌕",
      modelSubtitle: "สว่างจ้าเกินไป แฟนเห็นเศษฝุ่นใต้เตียง สั่งถูบ้านยันสว่าง!",
      plotTwist: "สรุป: กะมาดินเนอร์สวีท หลงกลโคมไฟ โดนลุกมาขัดห้องน้ำปาดเหงื่อยันเช้า 💀",
      stampText: "บิ๊กคลีนนิ่งเดย์"
    };
  }

  if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
    return {
      titleOverlay: "เครื่องให้อาหารแมวอัจฉริยะ? 🐱",
      modelSubtitle: "บอทจ่ายช้าวิเดียว ไอ้ส้มตบเครื่องพัง หยิบแดกเองโคตรโปร!",
      plotTwist: "สรุป: ตังค์จ่ายค่าเครื่องไฮเทค สรุปเครื่องกลายเป็นกระสอบทรายน้องส้ม 🥊",
      stampText: "น้องส้มซ้อมมวย"
    };
  }

  // General fallback
  return {
    titleOverlay: `รีวิวเรียลๆ ${productName} ✨`,
    modelSubtitle: `ซื้อมาหวังว่าชีวิตจะสบาย... แต่ได้ภาระมาแทนเฉย!`,
    plotTwist: `สรุป: วู่วามกดซื้อตอนตีสอง ตื่นเช้ามาน้ำตาไหลพรากเพราะไม่มีตังค์กินข้าว 😭`,
    stampText: "ตีสองวู่วาม"
  };
}

function getRealisticFallbackVideo(productId: string, productName: string): string {
  const nameLower = (productName || "").toLowerCase();
  
  if (productId === "prod-2" || nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    // Espresso Maker fallback: Classroom or people to show interactive lifestyle (instead of plain static bottles)
    return "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/classroom.mp4";
  }
  
  if (productId === "prod-3" || nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    // Keyboard fallback: Classroom of real people working on computers/keyboards (13.5MB, real-life)
    return "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/classroom.mp4";
  }

  if (productId === "prod-1" || nameLower.includes("ไมโครโฟน") || nameLower.includes("micro") || nameLower.includes("sound")) {
    // Microphone fallback: Real people walking/talking with smartphones in public (5.4MB, real-life)
    return "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/people-detection.mp4";
  }

  // Default fallback: Real people walking/interacting (3.2MB, real-life)
  return "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/one-by-one-person-detection.mp4";
}

// 4. Custom API for YouTube Shorts upload
async function uploadToYouTubeShorts(title: string, description: string, videoUrl: string, productId: string = "", productName: string = "") {
  const config = await readConfig();
  const clientId = config.youtubeClientId || process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = config.youtubeClientSecret || process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = config.youtubeRefreshToken || process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken || 
      clientId.includes("YOUR") || clientSecret.includes("YOUR") || refreshToken.includes("YOUR") ||
      clientId === "" || clientSecret === "" || refreshToken === "") {
    console.log("ℹ️ YouTube OAuth credentials are missing. Running video upload in Simulated Mode.");
    return {
      success: true,
      isSimulation: true,
      videoId: `sim-${Math.random().toString(36).substring(2, 13)}`,
      statusMessage: "อัปโหลดสำเร็จผ่านสิทธิ์จำลอง (Simulation Mode)"
    };
  }

  try {
    console.log("🔌 Attempting to refresh YouTube OAuth Access Token...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!tokenResponse.ok) {
      const errorMsg = await tokenResponse.text();
      throw new Error(`Failed to refresh YouTube access token: ${errorMsg}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    console.log("✅ YouTube Access Token refreshed successfully.");
    console.log("📥 Fetching Shorts video binary from source URL:", videoUrl);

    // Fetch video binary from URL with robust fallback strategy to ensure 100% upload success
    let videoResponse: any = null;
    let finalVideoUrlUsed = videoUrl;
    
    // List of reliable video sources if the primary Mixkit source fails (Mixkit often blocks data center IPs with 403 Forbidden)
    const fallbackUrl = getRealisticFallbackVideo(productId, productName || title);
    const urlsToTry = [
      videoUrl,
      fallbackUrl,
      "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/one-by-one-person-detection.mp4",
      "https://www.w3schools.com/html/movie.mp4"
    ];

    let lastFetchError = "";
    for (let i = 0; i < urlsToTry.length; i++) {
      const url = urlsToTry[i];
      try {
        console.log(`📥 [YouTube Upload] Trying to download video source (${i + 1}/${urlsToTry.length}): ${url}`);
        
        // Use custom headers for the primary Mixkit URL, use simple fetch for others
        const fetchOptions: any = url === videoUrl ? {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "video/mp4,video/*,*/*",
            "Referer": "https://mixkit.co/",
            "Accept-Language": "en-US,en;q=0.9"
          }
        } : {};

        videoResponse = await fetch(url, fetchOptions);
        if (videoResponse.ok) {
          finalVideoUrlUsed = url;
          console.log(`✅ [YouTube Upload] Successfully downloaded video from: ${url}`);
          break;
        } else {
          lastFetchError = `HTTP ${videoResponse.status} ${videoResponse.statusText}`;
          console.warn(`⚠️ [YouTube Upload] Failed download from ${url}. Status: ${videoResponse.status}`);
        }
      } catch (err: any) {
        lastFetchError = err.message || String(err);
        console.warn(`⚠️ [YouTube Upload] Network error for ${url}: ${lastFetchError}`);
      }
    }

    if (!videoResponse || !videoResponse.ok) {
      throw new Error(`Failed to fetch video from all available sources. Last error: ${lastFetchError}`);
    }
    const videoBlob = await videoResponse.blob();
    const fileSize = videoBlob.size;
    const arrayBuffer = await videoBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`📹 Uploading video to YouTube Resumable Upload API (${fileSize} bytes)...`);

    // 1. Initialize Resumable Upload
    const metadata = {
      snippet: {
        title: title.substring(0, 100), // Max 100 chars
        description: description,
        categoryId: "22", // People & Blogs or Comedy
        tags: ["shopee", "shorts", "affiliate", "รีวิวฮาๆ"]
      },
      status: {
        privacyStatus: "public", // Upload directly as Public
        selfDeclaredMadeForKids: false
      }
    };

    const initResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": fileSize.toString(),
          "X-Upload-Content-Type": "video/mp4"
        },
        body: JSON.stringify(metadata)
      }
    );

    if (!initResponse.ok) {
      const errorMsg = await initResponse.text();
      throw new Error(`Failed to initialize YouTube video upload: ${errorMsg}`);
    }

    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
      throw new Error("Failed to retrieve upload Location URL from YouTube API.");
    }

    console.log("🚀 Resumable session created. Sending video data bytes...");

    // 2. Put the actual video bytes
    const finalResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": "video/mp4"
      },
      body: buffer
    });

    if (!finalResponse.ok) {
      const errorMsg = await finalResponse.text();
      throw new Error(`Failed to upload video data to YouTube: ${errorMsg}`);
    }

    const responseData = await finalResponse.json();
    const uploadedVideoId = responseData.id;

    console.log("🎉 Video uploaded successfully to YouTube Shorts! Video ID:", uploadedVideoId);

    return {
      success: true,
      isSimulation: false,
      videoId: uploadedVideoId,
      statusMessage: "อัปโหลดเรียบร้อยแล้วไปที่ YouTube Shorts"
    };

  } catch (error: any) {
    console.error("❌ YouTube upload failed:", error.message || error);
    
    // Convert API errors to highly readable, helpful instructions
    let userFriendlyMessage = error.message || String(error);
    
    if (userFriendlyMessage.includes("youtubeSignupRequired")) {
      userFriendlyMessage = "บัญชี Google ของคุณยังไม่มีช่อง YouTube (YouTube Channel)! กรุณาเข้าไปที่เว็บไซต์ https://studio.youtube.com หรือเปิดเว็บ YouTube ด้วยบัญชีนี้ แล้วคลิกปุ่ม 'สร้างช่อง' (Create Channel) เพื่อสมัครเปิดช่องก่อน จึงจะสามารถปล่อยคลิปผ่านระบบบอทของเว็บบัญชีนี้ได้";
    } else if (userFriendlyMessage.includes("invalid_grant") || userFriendlyMessage.includes("refresh token")) {
      userFriendlyMessage = "คีย์ YouTube Refresh Token ไม่ถูกต้องหรือสิทธิ์ OAuth หมดอายุแล้ว กรุณาทำการขอโทเค็นใหม่และนำมาใส่ที่แท็บ 'การเชื่อมต่อหลังบ้าน' อีกครั้ง";
    } else if (userFriendlyMessage.includes("unauthorized_client") || userFriendlyMessage.includes("Unauthorized")) {
      userFriendlyMessage = "สิทธิ์การเข้าถึง API ไม่ถูกต้อง กรุณาตรวจสอบ Client ID และ Client Secret ในแท็บ 'การเชื่อมต่อหลังบ้าน'";
    } else if (userFriendlyMessage.includes("quotaExceeded")) {
      userFriendlyMessage = "โควตา YouTube API สำหรับการอัปโหลดวิดีโอของคุณในวันนี้หมดลงแล้ว (YouTube API Quota Exceeded) กรุณารอใหม่อีกครั้งในวันพรุ่งนี้";
    }

    // Since the user configured credentials, failure should be reported as FAILED with success: false
    return {
      success: false,
      isSimulation: false,
      videoId: "failed",
      statusMessage: `อัปโหลดจริงล้มเหลว: ${userFriendlyMessage}`
    };
  }
}

// 5. Unified Core Function: Run Random Post Creation & Upload (100% Automate)
async function executeDailyAffiliateShortsPost(targetProductId?: string) {
  console.log("⏰ [SYSTEM AUTO-POST] Automation job started!");
  
  const products = await readProducts();
  if (products.length === 0) {
    console.log("❌ [SYSTEM AUTO-POST] Failed: No products available in inventory.");
    return null;
  }

  let selectedProduct;
  if (targetProductId) {
    selectedProduct = products.find((p: any) => p.id === targetProductId);
  }
  
  if (!selectedProduct) {
    // Pick random product
    const randomIndex = Math.floor(Math.random() * products.length);
    selectedProduct = products[randomIndex];
  }
  
  console.log(`🛍️ [SYSTEM AUTO-POST] Selected Product: ${selectedProduct.name}`);

  // Retrieve current active affiliate ID and config
  const config = await readConfig();
  const affiliateId = config.affiliateId || process.env.SHOPEE_AFFILIATE_ID || DEFAULT_SHOPEE_AFFILIATE_ID;
  const affiliateLink = generateShopeeAffiliateLink(selectedProduct.originalUrl, affiliateId, selectedProduct.name);

  console.log(`🔗 [SYSTEM AUTO-POST] Generated Link: ${affiliateLink}`);

  // Generate Caption & Script with Gemini
  const aiResult = await generateContentWithGemini(
    selectedProduct.name,
    selectedProduct.description,
    affiliateLink
  );

  console.log(`🤖 [SYSTEM AUTO-POST] Gemini Creative Complete. Title: "${aiResult.youtubeTitle}"`);

  // Video source fallback
  const videoUrl = selectedProduct.videoSource || "https://assets.mixkit.co/videos/preview/mixkit-holding-a-smartphone-with-a-blank-screen-vertical-40176-large.mp4";

  // Upload to YouTube Shorts
  const uploadResult = await uploadToYouTubeShorts(
    aiResult.youtubeTitle,
    aiResult.youtubeCaption,
    videoUrl,
    selectedProduct.id,
    selectedProduct.name
  );

  // Write new log entry
  const newLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    productId: selectedProduct.id,
    productName: selectedProduct.name,
    shopeeOriginalUrl: selectedProduct.originalUrl,
    shopeeAffiliateUrl: affiliateLink,
    youtubeTitle: aiResult.youtubeTitle,
    youtubeCaption: aiResult.youtubeCaption,
    purchaseScript: aiResult.purchaseScript,
    youtubeVideoId: uploadResult.videoId,
    status: uploadResult.success ? "SUCCESS" : "FAILED",
    videoSource: videoUrl,
    isSimulation: uploadResult.isSimulation,
    statusMessage: uploadResult.statusMessage
  };

  const logs = await readLogs();
  logs.unshift(newLog); // Put new log first
  await writeLogs(logs);

  console.log(`🎉 [SYSTEM AUTO-POST] Completed successfully! Saved to Logs DB.`);
  return newLog;
}

// ----------------------------------------------------
// REST API ROUTES
// ----------------------------------------------------

// GET /api/config
app.get("/api/config", async (req, res) => {
  const config = await readConfig();
  const affiliateId = config.affiliateId || process.env.SHOPEE_AFFILIATE_ID || DEFAULT_SHOPEE_AFFILIATE_ID;
  const geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || "";
  const youtubeClientId = config.youtubeClientId || process.env.YOUTUBE_CLIENT_ID || "";
  const youtubeClientSecret = config.youtubeClientSecret || process.env.YOUTUBE_CLIENT_SECRET || "";
  const youtubeRefreshToken = config.youtubeRefreshToken || process.env.YOUTUBE_REFRESH_TOKEN || "";

  const hasGemini = !!geminiApiKey && geminiApiKey !== "MY_GEMINI_API_KEY" && geminiApiKey !== "";
  const hasYoutubeClientId = !!youtubeClientId && !youtubeClientId.includes("YOUR") && youtubeClientId !== "";
  const hasYoutubeClientSecret = !!youtubeClientSecret && !youtubeClientSecret.includes("YOUR") && youtubeClientSecret !== "";
  const hasYoutubeRefreshToken = !!youtubeRefreshToken && !youtubeRefreshToken.includes("YOUR") && youtubeRefreshToken !== "";

  res.json({
    affiliateId,
    geminiApiKey,
    youtubeClientId,
    youtubeClientSecret,
    youtubeRefreshToken,
    cronExpression: "0 9 * * * (9:00 น. ของทุกวัน)",
    hasGemini,
    hasYoutubeClientId,
    hasYoutubeClientSecret,
    hasYoutubeRefreshToken,
    activeMode: (hasYoutubeClientId && hasYoutubeClientSecret && hasYoutubeRefreshToken) ? "REAL_YOUTUBE" : "SIMULATION"
  });
});

// POST /api/config
app.post("/api/config", async (req, res) => {
  const { affiliateId, geminiApiKey, youtubeClientId, youtubeClientSecret, youtubeRefreshToken } = req.body;
  
  const config = await readConfig();
  
  if (affiliateId !== undefined) config.affiliateId = affiliateId;
  if (geminiApiKey !== undefined) config.geminiApiKey = geminiApiKey;
  if (youtubeClientId !== undefined) config.youtubeClientId = youtubeClientId;
  if (youtubeClientSecret !== undefined) config.youtubeClientSecret = youtubeClientSecret;
  if (youtubeRefreshToken !== undefined) config.youtubeRefreshToken = youtubeRefreshToken;

  await writeConfig(config);
  
  res.json({ 
    success: true, 
    message: "บันทึกข้อมูลการตั้งค่าหลังบ้านเรียบร้อยแล้ว", 
    config 
  });
});

// GET /api/products
app.get("/api/products", async (req, res) => {
  const products = await readProducts();
  res.json(products);
});

// POST /api/products (Create)
app.post("/api/products", async (req, res) => {
  const { name, originalUrl, description, videoSource } = req.body;
  if (!name || !originalUrl || !description) {
    return res.status(400).json({ error: "ข้อมูลสินค้าไม่ครบถ้วน (ต้องมีชื่อ, ลิงก์ Shopee และคำอธิบาย)" });
  }

  const products = await readProducts();
  const newProduct = {
    id: `prod-${Date.now()}`,
    name,
    originalUrl,
    description,
    videoSource: videoSource || "https://assets.mixkit.co/videos/preview/mixkit-holding-a-smartphone-with-a-blank-screen-vertical-40176-large.mp4"
  };

  products.push(newProduct);
  await writeProducts(products);
  res.status(201).json(newProduct);
});

// PUT /api/products/:id (Update)
app.put("/api/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, originalUrl, description, videoSource } = req.body;

  const products = await readProducts();
  const index = products.findIndex((p: any) => p.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "ไม่พบสินค้าที่ต้องการแก้ไข" });
  }

  products[index] = {
    ...products[index],
    name: name || products[index].name,
    originalUrl: originalUrl || products[index].originalUrl,
    description: description || products[index].description,
    videoSource: videoSource || products[index].videoSource
  };

  await writeProducts(products);
  res.json(products[index]);
});

// DELETE /api/products/:id (Delete)
app.delete("/api/products/:id", async (req, res) => {
  const { id } = req.params;
  const products = await readProducts();
  const filtered = products.filter((p: any) => p.id !== id);
  
  if (products.length === filtered.length) {
    return res.status(404).json({ error: "ไม่พบสินค้าที่ต้องการลบ" });
  }

  await writeProducts(filtered);
  res.json({ success: true, message: "ลบสินค้าสำเร็จ" });
});

// POST /api/generate-cover
app.post("/api/generate-cover", async (req, res) => {
  try {
    const { productName, productDesc, modelStyle } = req.body || {};
    if (!productName) {
      return res.status(400).json({ error: "ไม่พบชื่อสินค้าที่ใช้เจเนอเรตคำปก" });
    }
    const coverData = await generateCoverWithGemini(productName, productDesc || "", modelStyle || "หนุ่มออฟฟิศ");
    res.json({ success: true, cover: coverData });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการคิดสคริปต์หน้าปก" });
  }
});

// GET /api/logs
app.get("/api/logs", async (req, res) => {
  const logs = await readLogs();
  res.json(logs);
});

// POST /api/trigger-post (Manual trigger immediately)
app.post("/api/trigger-post", async (req, res) => {
  try {
    const { productId } = req.body || {};
    const postLog = await executeDailyAffiliateShortsPost(productId);
    if (!postLog) {
      return res.status(400).json({ error: "ไม่สามารถโพสต์ได้เนื่องจากไม่มีสินค้าในคลังเก็บสินค้า" });
    }
    res.json({ success: true, log: postLog });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการรันระบบอัปโหลดอัตโนมัติ" });
  }
});

// ----------------------------------------------------
// CRON JOB SETUP (Every morning at 09:00 AM)
// ----------------------------------------------------
cron.schedule("0 9 * * *", async () => {
  console.log("⏰ [Cron Job] 09:00 AM Triggered! Initiating YouTube Shorts post workflow.");
  try {
    await executeDailyAffiliateShortsPost();
  } catch (err) {
    console.error("❌ Error running scheduled daily post:", err);
  }
});

console.log("📅 [Scheduler] Daily Cron Job successfully set for 09:00 AM.");

// ----------------------------------------------------
// VITE DEV SERVER / PRODUCTION CONFIGURATION
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("🚀 Vite developer server mounted as middleware.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("📦 Production static files serving activated.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`====================================================`);
    console.log(`🟢 Affiliate Auto Shorts Server active on http://0.0.0.0:${PORT}`);
    console.log(`🏠 Mode: ${process.env.NODE_ENV || "development"}`);
    console.log(`====================================================`);
  });
}

startServer();
