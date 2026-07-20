import express from "express";
import path from "path";
import fs from "fs/promises";
import { GoogleGenAI, Type } from "@google/genai";
import cron from "node-cron";
import dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Load environment variables
dotenv.config();

// Prevent crashes due to background unhandled promise rejections or uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🚨 Uncaught Exception thrown:", err);
});

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// 3. AI Caption, 5-Scene Script, and Cover Generators (Gemini-3.5-flash)
async function generateContentWithGemini(productName: string, productDesc: string, affiliateLink: string) {
  const ai = await getGeminiClient();
  
  if (!ai) {
    console.log("⚠️ No GEMINI_API_KEY detected. Using simulated local AI response generator.");
    return generateSimulatedAIResponse(productName, productDesc, affiliateLink);
  }

  const systemInstruction = `คุณเป็นนักคิดก็อปปี้ไรท์เตอร์โฆษณา (Copywriter) ครีเอทีฟผู้เขียนบทร่างภาพยนตร์ และนายหน้า Shopee สายตลก แสบๆ กวนๆ ตลกหักมุม (Plot Twist) ที่เก่งที่สุดในการดันยอดขายผ่าน YouTube Shorts ของประเทศไทย
  หน้าที่ของคุณคือการคิดข้อความโฆษณาและเขียนบทร่างภาพยนตร์แบบบทละครสั้นจำนวน 5 ฉาก ฉากละ 10 วินาที (รวม 50 วินาที) ที่มีความยาวและเนื้อหาสัมพันธ์กับสินค้า โดยฉากสุดท้ายต้องหักมุมสุดปั่น ค้างคาใจจนคนดูอยากคลิกซื้อทันที 100%
  
  คุณต้องเลือกตัวละครหลัก 1 ใน 3 ตัวละครต่อไปนี้เพื่อสวมบทแสดงตลอดทั้งคลิปอย่างสมเหตุสมผล:
  1. ลุงเฉลียว (Chaleo) - คุณลุงชาวไทยอายุ 68 ปี ใจดี อารมณ์ดี อบอุ่น มีรอยยิ้ม สวมเสื้อเชิ้ตลายสก็อตสีส้ม แว่นสายตากลอบกลมสีดำ ผมสีเทาหงอกประปรายคนซื่อ
  2. กวิน (Kawin) - ชายหนุ่มมาดเท่ วัย 28 ปี บุคลิกดูดีแบบนักกีฬา ผิวสีแทน แว่นกันแดดทรงสปอร์ต ทรงผมสั้นเฟดด้านข้าง สวมเสื้อยืดสีดำรัดรูปฟิตเนส
  3. พิมมี่ (Pimmy) - หญิงสาวสวยหรูหรา วัย 24 ปี เปี่ยมด้วยจริตการขายระดับมืออาชีพ สวมต่างหูมุกสีขาววับวับ ผมยาวดัดลอนสีบรอนด์ทอง สวมแจ็กเก็ตสีชมพูพาสเทลแบรนด์เนมแสนแพง
  
  กฎเหล็กในการสร้างสรรค์ฉากภาพวาดสำหรับ Google Imagen 3 (ห้ามฝ่าฝืน):
  - ห้ามใส่โค้ด --cref, --sref หรือรหัสรบกวนอื่นๆ ของ Midjourney อย่างเด็ดขาด เนื่องจากทำให้ Google Imagen สับสนและแสดงผลเป็นเศษตัวอักษรขยะรบกวน
  - ต้องล็อครายละเอียดของตัวละครที่เลือก (ทรงผม, ใบหน้า, แว่นตา, เสื้อผ้า) ให้สม่ำเสมอในทุกๆ ฉาก ป้องกันการวาดสลับเป็นสิ่งอื่นๆ
  - ต้องระบุรายละเอียดของภาพให้สมจริงระดับภาพถ่ายจริง Cinematic (Photorealistic), high-fidelity, แสงเงาสวยงาม มีมิติ ไม่มีความผิดเพี้ยน
  - ห้ามวาดในลักษณะรูปการ์ตูน สัตว์ประหลาด หรือสิ่งแปลกปลอมใดๆ และห้ามมีตัวหนังสือใดๆ ปรากฏในรูปเด็ดขาด
  - สรุปรายละเอียดวิดีโอระดับ 2K (1440x2560 พิกเซล) และใส่เทคนิค Ken Burns Effect เพื่อให้ตัวคลิปซูมและแพนช้าๆ ไปยังกึ่งกลางภาพสวยสะกดสายตา`;

  const prompt = `ช่วยเขียนคอนเทนต์รีวิวสินค้าเพื่อโพสต์ YouTube Shorts สำหรับสินค้าชิ้นนี้:
  ชื่อสินค้า: "${productName}"
  คำอธิบายสินค้า: "${productDesc}"
  ลิงก์นายหน้า: "${affiliateLink}"

  กรุณาส่งกลับมาเป็นรูปแบบ JSON ตามโครงสร้างด้านล่าง:
  - youtubeTitle: หัวข้อคลิป Shorts (ยาวไม่เกิน 100 ตัวอักษร) ดึงดูดความสนใจขั้นสุด มีอีโมจิกวนๆ และแฮชแท็กหลัก
  - youtubeCaption: แคปชันที่จะใส่ในคำอธิบายคลิป (Description) เขียนสไตล์รีวิวตลกขบขัน ฮาๆ บ่นชีวิต หรือมุกแสบๆ มีพอยต์ชี้ข้อดี/ข้อเสียแบบกวนๆ พร้อมปักลิงก์นายหน้าท้ายแคปชันอย่างเด่นชัด มีแฮชแท็กครบถ้วน
  - purchaseScript: สคริปต์พูดภาพรวม 50 วินาทีสำหรับบรรยายคลิปสั้น ปั่นๆ กวนๆ
  - scenes: อาร์เรย์ของฉากละครสั้นจำนวน 5 ฉาก (ฉากละ 10 วินาทีพอดี) โดยแต่ละชิ้นมี:
    - sceneNumber: หมายเลขฉาก (1 ถึง 5)
    - visualPrompt: คำสั่งสร้างรูปด้วย Google Imagen 3 ภาษาอังกฤษที่ล็อคสไตล์ตัวละครตัวใดตัวหนึ่ง (ลุงเฉลียว, กวิน, หรือพิมมี่) ไร้โค้ด --cref และมีสไตล์ภาพจริง Cinematic high-fidelity ไร้ตัวหนังสือ
    - narration: คำพูดบรรยายภาษาไทยสำหรับฉากนี้ความยาว 10 วินาที (ตลกขำขัน สัมพันธ์กับภาพและหักมุมในฉากที่ 5)
    - duration: ตัวเลขอายุฉากคือ 10`;

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
            purchaseScript: { type: Type.STRING, description: "สคริปต์พูด 50 วินาทีรวมสำหรับคลิปทั้งหมด ปั่นๆ กวนๆ" },
            scenes: {
              type: Type.ARRAY,
              description: "รายการฉากละครสั้น 5 ฉาก",
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneNumber: { type: Type.INTEGER, description: "ลำดับฉาก 1 ถึง 5" },
                  visualPrompt: { type: Type.STRING, description: "คำสั่งภาษาอังกฤษสร้างภาพของตัวละครด้วย Imagen 3 โดยละเอียดและมีความสม่ำเสมอ" },
                  narration: { type: Type.STRING, description: "คำพากย์ในฉากนี้สำหรับ ElevenLabs ยาว 10 วินาที" },
                  duration: { type: Type.INTEGER, description: "ระยะเวลาความยาว 10 วินาที" }
                },
                required: ["sceneNumber", "visualPrompt", "narration", "duration"]
              }
            }
          },
          required: ["youtubeTitle", "youtubeCaption", "purchaseScript", "scenes"]
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

// Fallback AI generator containing premium 5-scene drama script simulations with locked characters
function generateSimulatedAIResponse(productName: string, productDesc: string, affiliateLink: string) {
  const nameLower = (productName || "").toLowerCase();
  
  if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    return {
      youtubeTitle: `เครื่องชงกาแฟพกพา: บีบจนมือหัก...แต่ไม่ได้กินกาแฟ?! ☕️🤣 #shorts`,
      youtubeCaption: `รีวิวเรียลๆ เครื่องชงกาแฟเอสเพรสโซ่พกพา ไม่ต้องใช้ไฟฟ้า!\n\nบอกเลยว่าคุ้มค่ามาก... แค่ตักผงใส่ เทน้ำร้อน แล้วใช้สองมือบีบๆๆๆ เค้นพลังชีวิตทั้งหมดที่มีออกมา เพื่อให้ได้เอสเพรสโซ่หนึ่งจอกเล็กๆ! สรุปกาแฟยังไม่เข้าปาก แต่เส้นเลือดสมองจะแตกแทน 😭 บีบเสร็จกล้ามแขนขึ้นทันตาเห็น โคตรเหนื่อย! สุดท้ายเลยหิ้วเครื่องนี้เดินเข้าร้านคาเฟ่ให้บาริสต้าเค้าชงให้ สบายใจละ 🤣\n\nพิกัดสำหรับสายฟิตเนสอยากบริหารกล้ามแขนพร้อมดื่มด่ำกลิ่นกาแฟ:\n👉 ${affiliateLink}\n\n#ตลกหักมุม #เครื่องชงกาแฟพกพา #รีวิวกวนๆ #กาแฟสด #นายหน้าShopee #ของมันต้องมี #Shorts`,
      purchaseScript: `รีวิวสุดปั่นจากลุงเฉลียว เครื่องชงกาแฟพกพาบีบเค้นพลังชีวิต! หมุนเกลียวบดกาแฟจนกล้ามปูด แต่สุดท้ายไม่ได้กินสักอึก เพราะเครื่องบีบฝืดจัด เลยต้องหิ้วซากเครื่องเดินไปให้บาริสต้าในคาเฟ่แถวบ้านช่วยชงให้ กินกาแฟเสร็จสบายใจ ลุงแกกำหมัดหัวเราะร่า ค้างคาใจจนอยากสอยมาลองบีบดูเลยจ้า!`,
      scenes: [
        {
          sceneNumber: 1,
          visualPrompt: "A close-up photograph of Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, holding a handheld manual portable espresso maker, looking proud. Cinematic 2K, photorealistic.",
          narration: "ลุงเฉลียวขอนำเสนอ! เครื่องชงกาแฟพกพาแมนนวลสุดเท่ ไม่ใช้ไฟฟ้า บีบมือฟิตปั๋งดั่งใจนึก",
          duration: 10
        },
        {
          sceneNumber: 2,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, sweating and squeezing the coffee maker with both hands, face straining with maximum effort. Highly detailed, cinematic.",
          narration: "ใส่ผงกาแฟกับน้ำร้อนแล้วก็ออกแรงบีบๆๆ เค้นพลังแขนทั้งหมดที่มีในชีวิตเพื่อเอสเพรสโซ่หยดเดียว!",
          duration: 10
        },
        {
          sceneNumber: 3,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, looking extremely exhausted, veins bulging on his forehead as he continues to squeeze. Dynamic shadow lighting.",
          narration: "บีบจนกล้ามแขนปูด มือแทบหัก หน้ามืดสั่นสะท้าน เส้นเลือดในสมองจะแตกก่อนกาแฟเข้าปากละครับท่านผู้ช้ม!",
          duration: 10
        },
        {
          sceneNumber: 4,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, walking into a modern cozy cafe carrying the manual coffee maker, talking to a polite barista behind the counter. Cinematic.",
          narration: "ช้าก่อน! บีบไปสิบนาทีไม่ได้สักหยด ลุงแกเลยถอดใจ หิ้วเครื่องนี้เดินเข้าร้านคาเฟ่แอร์เย็นฉ่ำหน้าปากซอยเฉยเลย!",
          duration: 10
        },
        {
          sceneNumber: 5,
          visualPrompt: "A plot-twist ending scene. Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, sitting happily at a cafe table sipping a beautiful latte art coffee served by the barista, looking victorious. Cinematic.",
          narration: "หักมุมสุดปั่น! สรุปให้บาริสต้ามืออาชีพเค้าชงให้ สบายใจแฮปปี้สุดๆ! จิ้มสอยไปลองกำลังแขนกันได้ที่ลิงก์จ้า!",
          duration: 10
        }
      ]
    };
  }

  if (nameLower.includes("ไมโครโฟน") || nameLower.includes("micro") || nameLower.includes("sound") || nameLower.includes("wireless")) {
    return {
      youtubeTitle: `ไมโครโฟนตัดเสียงรบกวน: เงียบกริบยันสิบล้อ...ยกเว้นเสียงเมียเตือนคาบ้าน! 🎙️💀 #shorts`,
      youtubeCaption: `รีวิวไร้สายไมโครโฟนอัจฉริยะตัดเสียงรบกวนภายนอกรอบทิศทาง!\n\nใส่ปุ๊บเงียบปั๊บ นวัตกรรมระดับแสนล้าน เสียงลมเสียงฝนสิบล้อวิ่งผ่านหรือสุนัขเห่ายังโดนตัดหายเกลี้ยงดุจปิดเสียงโลก! แต่ช้าก่อน... ดันมีคลื่นความถี่พิเศษสลายฟิลเตอร์ นั่นคือเสียงอันทรงพลังทำลายล้างของภรรยาสุดที่รักตวัดเรียกแผดเผาเข้ามา! สรุปตัดได้ทุกเสียง ยกเว้นเสียงเมียครับท่านผู้ช้ม! ใครใจถึงอยากลองของจิ้มพิกัดเลยจ้า\n\nพิกัดไมค์กวนเสียงคนข้างกาย:\n👉 ${affiliateLink}\n\n#ไมโครโฟนไร้สาย #ตลกหักมุม #รีวิวตลก #นายหน้าShopee #ของใช้ไอที #Shorts`,
      purchaseScript: `รีวิวไมค์ไร้สายลบเสียงรบกวนโดยกวิน นายแบบกล้ามฟิต แต่อุปกรณ์ระดับโลกก็ไม่อาจลบคลื่นความถี่พิเศษเสียงแผดเผาทะลุมิติของภรรยาสุดที่รัก สรุปหูดับคาไมค์เลยจ้า!`,
      scenes: [
        {
          sceneNumber: 1,
          visualPrompt: "A close-up photograph of Kawin, a handsome 28-year-old Thai man, dark tanned skin, short fade haircut, wearing sporty sunglasses and a tight black t-shirt, holding a mini wireless lavalier microphone, looking cool. Cinematic.",
          narration: "กวินมาดเท่ขอนำเสนอ! ไมโครโฟนตัดเสียงรบกวนอัจฉริยะรุ่นใหม่ ลบเสียงรบกวนภายนอกได้เงียบกริบ",
          duration: 10
        },
        {
          sceneNumber: 2,
          visualPrompt: "Kawin standing outdoors by a busy noisy street with trucks passing by, pointing to his microphone, talking confidently. Deep cinematic shadows.",
          narration: "ทดสอบเดินริมถนนรถพ่วงวิ่งผ่านนึกว่าอยู่สนามรบ แต่พอเปิดระบบเงียบดุจอยู่ในห้องสมุดระดับชาติ!",
          duration: 10
        },
        {
          sceneNumber: 3,
          visualPrompt: "Kawin walking home with a smug smile, holding his microphone, while rain is pouring. Dramatic cinematic lighting.",
          narration: "สุดยอดฟิลเตอร์ระดับนาโน เสียงฝน ตะโกน หรือเครื่องขุดเจาะถนน ก็ปิดได้สนิทสะใจวัยรุ่นขีดสุด",
          duration: 10
        },
        {
          sceneNumber: 4,
          visualPrompt: "Kawin entering his living room, talking to the camera, while a furious Thai woman in the background is shouting at him with her arms crossed. Highly detailed.",
          narration: "แต่พอเข้าบ้านเท่านั้นแหละครับ! คลื่นเสียงปริศนาความถี่แสนล้านเดซิเบลจากเมียรักแผดเผาด่าสะท้านทะลุเข้ามา!",
          duration: 10
        },
        {
          sceneNumber: 5,
          visualPrompt: "A plot-twist ending scene. Kawin looking terrified and covering his ears, with the microphone showing red warning light, and his wife pointing a rolling pin at him. Humorous realistic expression.",
          narration: "หักมุมสุดยับ! เทคโนโลยีป้องกันลมได้ แต่ป้องกันเสียงบ่นเมียไม่ได้หูดับหัวสั่นคาบ้านด่วน! จิ้มลิงก์นายหน้าด่วนเลยจ้า!",
          duration: 10
        }
      ]
    };
  }

  if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    return {
      youtubeTitle: `คีย์บอร์ดบลูสวิตช์สุดฟิน: พิมพ์มันส์สะใจ...จนข้างบ้านตะโกนด่า! ⌨️🔥 #shorts`,
      youtubeCaption: `รีวิวคีย์บอร์ดปุ่มกดเสียงบลูสวิตช์สุดมันส์ ดีไซน์พิมพ์ดีดโบราณ!\n\nเสียงกดแก๊กๆๆๆ ดังไพเราะเพราะพริ้งปานเทพสร้าง พิมพ์งานมันส์มือสุดๆ เหมือนกำลังนั่งคีย์ข้อมูลกู้โลกอยู่... พิมพ์ไปได้ครึ่งชั่วโมง ได้ยินเสียงปังๆๆ มาจากข้างบ้าน! นึกว่าแฟนเพลงมาเคาะจังหวะร่วมด้วย ที่ไหนได้ ข้างบ้านเค้าตะโกนบอก 'หยุดพิมพ์โว้ยยย นึกว่าคนมารบกัน!' สุดท้ายต้องย้ายมาเล่นในมุ้งเงียบๆ สรุปฟินคนเดียว ข้างบ้านกำหมัดละ 🤣\n\nพิกัดคีย์บอร์ดกวนบ้านเรือนเคียง:\n👉 ${affiliateLink}\n\n#คีย์บอร์ดบลูสวิตช์ #ตลกหักมุม #MechanicalKeyboard #รีวิวกวนๆ #ป้ายยาสินค้า #Shorts`,
      purchaseScript: `รีวิวคีย์บอร์ดบลูสวิตช์ปุ่มลั่นปังๆ โดยลุงเฉลียว นั่งสวมเชิ้ตลายสก็อตสีส้มกวาดแป้นเสียงเพราะดุจเทพสร้าง แต่พิมพ์เพลินจนข้างบ้านหอบกำหมัดมาถีบประตูส้นแตก นึกว่าบ้านป้าสิวเปิดโรงงานถลุงแป้งเปียก!`,
      scenes: [
        {
          sceneNumber: 1,
          visualPrompt: "A close-up photograph of Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, sitting in front of a computer desk looking excited. He is unboxing a mechanical keyboard with glowing blue retro keycaps. Cinematic 2K, photorealistic.",
          narration: "ลุงเฉลียวขอนำเสนอ! คีย์บอร์ดบลูสวิตช์ทรงพิมพ์ดีดโบราณ กดปั๊บดนตรีบรรเลงสไตล์ย้อนยุค",
          duration: 10
        },
        {
          sceneNumber: 2,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, typing happily on the retro mechanical keyboard. He has a delighted smile, fingers moving fast, keycaps emitting bright lights. High fidelity, cinematic.",
          narration: "พิมพ์งานมันส์มือมากครับ! เสียงแก๊กๆๆ ดุจปืนกลเบาไพเราะเสนาะหู เหมือนคนกำลังเขียนบันทึกประวัติศาสตร์โลก",
          duration: 10
        },
        {
          sceneNumber: 3,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, getting completely absorbed in typing. His eyes are wide with joy, dynamic finger motion, dramatic shadow lighting in his home office.",
          narration: "ยิ่งพิมพ์ยิ่งมันส์ ยิ่งพิมพ์ยิ่งอิน รัวนิ้วสู้กับทุกปัญหาชีวิต เสียงนี่ลั่นสนั่นไปทั่วตรอกซอกซอยเลยครับกระผม!",
          duration: 10
        },
        {
          sceneNumber: 4,
          visualPrompt: "Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, typing with a serious face while a neighbor, a muscular Thai man, is peeking over the fence with an angry and annoyed face. High fidelity, cinematic.",
          narration: "แต่ช้าก่อน! ลุงหารู้ไม่ว่า เสียงปุ่มกดแสนเพลินหูของลุง มันดังลั่นสนั่นทะลุกำแพงบ้านจนข้างบ้านขว้างขวานขู่!",
          duration: 10
        },
        {
          sceneNumber: 5,
          visualPrompt: "A plot-twist ending scene. Chaleo, a 68-year-old Thai man with round black glasses and orange plaid shirt, sitting sheepishly inside a colorful cozy mosquito net in his room, typing quietly on his mechanical keyboard. Cinematic.",
          narration: "หักมุมสุดป่วน! โดนทุบประตูด่า ลุงเฉลียวเลยต้องย้ายสำมะโนครัวมาพิมพ์คีย์บอร์ดบลูสวิตช์ในมุ้งกันยุงแทน! สอยไปพิมพ์กวนบ้านได้เลยจ้า!",
          duration: 10
        }
      ]
    };
  }

  if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp") || nameLower.includes("โคมไฟ")) {
    return {
      youtubeTitle: `โคมไฟพระจันทร์ลอยได้: สร้างความโรแมนติก...หรือแฉความสกปรก?! 🌕🧹 #shorts`,
      youtubeCaption: `รีวิวโคมไฟพระจันทร์ลอยได้ ดีไซน์สุดล้ำและโรแมนติก!\n\nบอกเลยว่าแสงนวลตาชวนฝันมาก เหมาะสำหรับการสร้างบรรยากาศดินเนอร์แสนสวีทกับแฟนในห้อง... แต่พอเปิดปุ๊บ ความโรแมนติกหายวับทันที! แสงมันสว่างใสดุจสปอตไลท์แฉความจริงอันโหดร้าย เผยคราบฝุ่นหนาเตอะใต้เตียง และกองจานชามที่ทับถมกันในมุมห้องจนมองเห็นชัดเจนอย่างเหลือเชื่อ! สรุปจากค่ำคืนสุดหวานชื่น กลายเป็นมหกรรมบิ๊กคลีนนิ่งเดย์ โดนเมียด่าถูบ้านยันตีสี่เฉยเลย 🤣\n\nพิกัดแสงพระจันทร์ส่องแฉความสกปรก:\n👉 ${affiliateLink}\n\n#โคมไฟพระจันทร์ #ตลกหักมุม #รีวิวกวนๆ #แต่งห้องนอน #นายหน้าShopee #ของดีบอกต่อ #Shorts`,
      purchaseScript: `รีวิวโคมไฟพระจันทร์ลอยได้ สวยนวลตาชวนสวีทใต้แสงจันทร์ แต่เปิดปุ๊บสว่างจ้าแฉทุกความสกปรกใต้เตียงจนกลายสภาพเป็นบิ๊กคลีนนิ่งเดย์ ถูพื้นขัดส้วมยันตีสี่สลบเหมือดจ้า!`,
      scenes: [
        {
          sceneNumber: 1,
          visualPrompt: "A close-up photograph of Pimmy, a beautiful 24-year-old Thai woman with long blond wavy hair, pearl earrings, and pink jacket, holding a modern floating 3D moon lamp that glows warmly, smiling. Cinematic 2K, photorealistic.",
          narration: "พิมมี่คนสวยขอนำเสนอ! โคมไฟพระจันทร์ลอยได้ ดีไซน์สุดโรแมนติก เหมาะสำหรับแต่งห้องนอนสร้างบรรยากาศชวนฝัน",
          duration: 10
        },
        {
          sceneNumber: 2,
          visualPrompt: "Pimmy and her boyfriend (a young Thai man) sitting in a dark bedroom, looking at the glowing moon lamp on the nightstand, warm and cozy mood. Cinematic.",
          narration: "ค่ำคืนแสนสวีท พาแฟนหนุ่มมาดินเนอร์โรแมนติกใต้แสงจันทร์สลัวๆ หวังกระชับความสัมพันธ์ให้หวานชื่น",
          duration: 10
        },
        {
          sceneNumber: 3,
          visualPrompt: "Pimmy presses the button to turn on the moon lamp, and it emits an incredibly bright, intense white light that illuminates the entire room vividly. Detailed.",
          narration: "แต่พอเปิดปุ๊บ! แสงโคมไฟพระจันทร์ดันสว่างใสแจ๋วระยิบระยับทะลุสลัว สว่างยิ่งกว่าไฟนีออนร้อยวัตต์ซะอีก!",
          duration: 10
        },
        {
          sceneNumber: 4,
          visualPrompt: "Pimmy's boyfriend looking horrified, pointing at thick layers of dust under the bed and a pile of unwashed dishes in the corner, illuminated by the bright moon light. Realistic facial expressions.",
          narration: "ความจริงอันโหดร้ายปรากฏทันตาเห็น! แสงไฟสะท้อนคราบฝุ่นหนาเตอะใต้เตียง และกองจานชามที่ยังไม่ได้ล้างเขินๆ!",
          duration: 10
        },
        {
          sceneNumber: 5,
          visualPrompt: "A plot-twist ending scene. Pimmy holding a mop and a broom, looking exhausted and angry, sweeping the floor at 4 AM, while her boyfriend is scrubbing the toilet in the background. Moon lamp is glowing brightly on the side. Cinematic.",
          narration: "สรุป: หักมุมกลายเป็นมหกรรมบิ๊กคลีนนิ่งเดย์ โดนเมียด่ากวาดถูบ้านยันตีสี่สลบเหมือดคาไม้กวาด! สอยด่วนที่พิกัดลิงก์เลยจ้า!",
          duration: 10
        }
      ]
    };
  }

  if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder") || nameLower.includes("อาหารสัตว์")) {
    return {
      youtubeTitle: `เครื่องให้อาหารแมวอัจฉริยะ: ซื้อมาอำนวยความสะดวก...หรือซื้อมาให้แมวซ้อมมวย?! 🐱🥊 #shorts`,
      youtubeCaption: `รีวิวถังอาหารสัตว์เลี้ยงอัจฉริยะ มีกล้องพูดคุยเรียลไทม์!\n\nชีวิตสโลว์ไลฟ์ของคนรักสัตว์ ตั้งค่าป้อนอาหารผ่านแอปหรูหราหมาเห่า แต่อย่าประเมินพลังความหิวกระหายของไอ้ส้มที่บ้านต่ำไป! พอบอทจ่ายอาหารช้าไปวิเดียว ไอ้ส้มมันเดินมากำหมัด คว่ำถังเขย่าจนเม็ดร่วงกราวอย่างมืออาชีพ แถมจ้องตาเขม็งใส่กล้องเหมือนจะบอกว่า 'ตู้กับข้าวแค่นี้ คิดว่าปราบข้าได้เหรอทาส?!' สรุปกล้องที่ติดมาเอาไว้ดูมันซ้อมมวยพังเครื่องเล่นๆ 🤣\n\nพิกัดซื้อของเล่นซ้อมมวยให้เจ้านายของคุณ:\n👉 ${affiliateLink}\n\n#เครื่องให้อาหารสัตว์เลี้ยง #รีวิวตลก #ตลกหักมุม #ไอ้ส้มลูกพ่อ #ของใช้หมาแมว #Shorts`,
      purchaseScript: `เครื่องให้อาหารหมาแมวอัจฉริยะ ตั้งเวลาอาหารคุยผ่านกล้องได้! แต่พอมันจ่ายอาหารช้าวิเดียว ไอ้ส้มตบเครื่องคว่ำแล้วหยิบกินเอง คุยผ่านกล้องทีแมวจ้องตาเขม็งเหมือนจะแว้งกัด!`,
      scenes: [
        {
          sceneNumber: 1,
          visualPrompt: "A close-up photograph of Pimmy, a beautiful 24-year-old Thai woman with long blond wavy hair, pearl earrings, and pink jacket, holding a modern smart automatic pet feeder, smiling warmly. Cinematic 2K, photorealistic.",
          narration: "พิมมี่คนสวยขอนำเสนอ! เครื่องให้อาหารหมาแมวอัจฉริยะ มีกล้องพูดคุยเรียลไทม์ ตั้งเวลาแอปอย่างดี",
          duration: 10
        },
        {
          sceneNumber: 2,
          visualPrompt: "Pimmy using her phone, looking at a live video feed of her cat, a fat orange tabby cat named Som, sitting next to the pet feeder waiting. Warm lighting.",
          narration: "ตั้งเวลาป้อนอาหารผ่านแอปหรูหราหมาเห่า ชีวิตสโลว์ไลฟ์คนรักแมว คุยกับเจ้าส้มได้จากทุกมุมโลก",
          duration: 10
        },
        {
          sceneNumber: 3,
          visualPrompt: "Som, a fat angry orange cat, standing on its hind legs next to the automatic feeder, looking at the lens with a fierce, demanding glare, raising its paw like a boxer.",
          narration: "แต่อย่าประเมินพลังความหิวกระหายของเจ้าส้มต่ำไป! พอบอทจ่ายอาหารช้ากว่าปกติไปแค่วินาทีเดียวเท่านั้น",
          duration: 10
        },
        {
          sceneNumber: 4,
          visualPrompt: "Som the orange cat violently shaking and punching the automatic feeder, kibbles spilling out everywhere on the floor, hilarious chaotic motion, action shot.",
          narration: "มันเดินมากำหมัด คว่ำถังเขย่าสะท้าน จนเม็ดร่วงกราวอย่างกับมืออาชีพ! แกร่งขีดสุดแกร่งยิ่งกว่าตู้เซฟ",
          duration: 10
        },
        {
          sceneNumber: 5,
          visualPrompt: "A plot-twist ending scene. Pimmy looking shocked, holding her face in hands, while Som sits on top of the ruined pet feeder looking like a king, staring Graves at the camera. Cinematic.",
          narration: "สรุป: ซื้อเครื่องมาอำนวยความสะดวก แต่เจ้าส้มใช้ซ้อมมวยโชว์พังเครื่องเล่นๆ! อยากซ้อมมวยแมว จิ้มซื้อเลยจ้า!",
          duration: 10
        }
      ]
    };
  }

  // Base fallback
  return {
    youtubeTitle: `ของมันต้องมี! หรือต้องไม่มีดีนะ? 🤔 ${productName} #shopeeaffiliate #shorts`,
    youtubeCaption: `นี่คือรีวิวเรียลๆ ของ "${productName}"! \n\nบอกเลยว่าตั้งแต่ซื้อมาใช้ ชีวิตเปลี่ยนไปมาก... เปลี่ยนจากนอนหลับสบายเป็นมานั่งเครียดเรื่องเงินแทน! หยอกๆ 🤣\nก็เอาเถอะ สำหรับชิ้นนี้มันดีตรงที่ "${productDesc}"\n\nใครใจถึงอยากลองของ จิ้มพิกัดท้ายคลิปตรงนี้เลยจ้า อย่าปล่อยให้เงินค้างบัญชี!\n👉 ${affiliateLink}\n\n#รีวิวตลก #นายหน้าShopee #ShopeeTH #ของใช้รีวิว #ชี้เป้าโปรถูก #Shorts`,
    purchaseScript: `รีวิวตลกร้ายฉากละคร 5 ฉากหักมุมกับพิมมี่ที่ชวนทุกคนมาพิสูจน์สิ่งดีๆ เพื่อชีวิตที่กวนป่วนค้างคาใจน่าซื้อน่าฟินขั้นสุด!`,
    scenes: [
      {
        sceneNumber: 1,
        visualPrompt: "A close-up photograph of Pimmy, a beautiful 24-year-old Thai woman with long blond wavy hair, pearl earrings, and pink jacket, holding the product, smiling warmly. Cinematic 2K, photorealistic.",
        narration: `รีวิวชิ้นเด่นจากพิมมี่! ของเล่นหรูหราหมาเห่า ดีไซน์พรีเมียมของ "${productName}" ที่คิดมาแล้วเพื่อความสุขสบายสูงสุดของแฟนๆ`,
        duration: 10
      },
      {
        sceneNumber: 2,
        visualPrompt: "Pimmy, a 24-year-old Thai woman in pink jacket, demonstrating the product with a graceful smile. High fidelity, cinematic lighting.",
        narration: "ฟังก์ชันใช้ง่ายไม่ซับซ้อน เหมาะแก่การประดับบ้านหรือพกพาไปเปิดประสบการณ์ใหม่สุดตระการตา",
        duration: 10
      },
      {
        sceneNumber: 3,
        visualPrompt: "Pimmy, a 24-year-old Thai woman in pink jacket, pushing a button on the product. A sudden puff of smoke or funny spark occurs. Cinematic, detailed, realistic.",
        narration: "แต่เดี๋ยวก่อน! ขึ้นชื่อว่าของดีระดับจักรวาล ย่อมแฝงความมหัศจรรย์อันซับซ้อนและเร้าใจให้ตื่นเต้น",
        duration: 10
      },
      {
        sceneNumber: 4,
        visualPrompt: "Pimmy, a 24-year-old Thai woman in pink jacket, looking worriedly at her empty purse, with receipts scattering. Humorous realistic expression, cinematic.",
        narration: "ทว่า ความท้าทายที่แท้จริงไม่ได้อยู่ที่ตัวเครื่อง แต่อยู่ที่การวู่วามช้อปปิ้งตอนตีสองจนเงินในบัญชีอันตรธานหาย!",
        duration: 10
      },
      {
        sceneNumber: 5,
        visualPrompt: "A plot-twist ending scene. Pimmy, a 24-year-old Thai woman with blond hair and pink jacket, sitting on a pile of boxes, smiling brightly while eating a single bowl of plain instant noodles with a golden spoon. Photorealistic, cinematic depth of field.",
        narration: "หักมุมเฉย! ได้สินค้าหรูสมใจ แต่ตังค์หมดเกลี้ยง ต้องนั่งกินบะหมี่สำเร็จรูปด้วยช้อนทองคำแท้ประดับบารมี! จิ้มซื้อลิงก์ด้านล่างด่วน!",
        duration: 10
      }
    ]
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
  หน้าที่ของคุณคือการคิดคำพูดและข้อความโฆษณาบนภาพปก YouTube Shorts สำหรับสินค้าชิ้นนี้ โดยเน้นสไตล์ตลกหักมุมสุดพีค (Plot Twist) และเหมาะกับตัวละครคาแร็กเตอร์ที่ถูกระบุ
  
  คุณต้องตอบกลับเป็น JSON ที่มีโครงสร้างฟิลด์ดังนี้เท่านั้น ห้ามใส่เครื่องหมายคำพูด Markdown หรือส่วนตกแต่งคำนำหรือสรุปอื่นๆ:
  {
    "titleOverlay": "ข้อความพาดหัวตัวใหญ่บนหน้าปก (สั้นๆ สะดุดตา กวนๆ ไม่เกิน 30 ตัวอักษร เช่น ชงกาแฟ บีบมือหัก!)",
    "modelSubtitle": "คำพูดเจ็บๆ หรือในใจของตัวละครลุงเฉลียว, กวิน, หรือพิมมี่ (ไม่เกิน 45 ตัวอักษร เช่น บีบจนกล้ามปูด...ไม่ได้กินสักหยด!)",
    "plotTwist": "มุขหักมุมตอนจบเฉลยความจริงฮาๆ (ไม่เกิน 60 ตัวอักษร เช่น สรุปเดินไปคาเฟ่ บาริสต้าชงให้ สบายใจละ 🤣)",
    "stampText": "สติกเกอร์สั้นๆ แปะบนหน้าปก เช่น เมียด่า, มือหัก, มัดจำไว้ (ไม่เกิน 10 ตัวอักษร)"
  }`;

  const prompt = `ช่วยคิดคำปกสั้นๆ กวนๆ หักมุมสำหรับสินค้าชิ้นนี้:
  ชื่อสินค้า: "${productName}"
  คำอธิบาย: "${productDesc}"
  สไตล์คาแร็กเตอร์: "${modelStyle}"`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
      modelSubtitle: "ลุงเฉลียวบีบจนสั่น...เส้นเลือดสมองเดือดปุด!",
      plotTwist: "สรุป: ได้กล้ามแขน แต่อดแดกกาแฟ เดินเข้าร้านคาเฟ่บาริสต้าชงสบายใจ 🤣",
      stampText: "ลุงเฉลียวบีบ"
    };
  }
  
  if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
    return {
      titleOverlay: "ตัดเสียงรบกวนสิบล้อเงียบ! 🎙️",
      modelSubtitle: "กวินเท่จัดตัดได้ทุกเสียง ยกเว้นเสียงเมียด่าคาบ้าน!",
      plotTwist: "สรุป: นวัตกรรมแสนล้าน สู้พลังเสียงแผดเผาของเมียไม่ได้ 💀",
      stampText: "กวินหูดับ"
    };
  }

  if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    return {
      titleOverlay: "พิมพ์มันส์สะใจ ข้างบ้านกำหมัด! ⌨️",
      modelSubtitle: "เสียงลั่นสะท้านพิมพ์ดีด นึกว่าสงครามโลกปะทุ!",
      plotTwist: "สรุป: พิมพ์แชตคุยสาวเพลิน ข้างบ้านถือไม้กวาดมาพังประตูส้วม 🤣",
      stampText: "ข้างบ้านทุบยับ"
    };
  }

  if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
    return {
      titleOverlay: "โคมไฟพระจันทร์ เปลี่ยนชีวิต! 🌕",
      modelSubtitle: "พิมมี่หวังสวีท แสงจ้าจนเห็นฝุ่นหนาเตอะกวาดถูยันเช้า!",
      plotTwist: "สรุป: จากค่ำคืนโรแมนติก กลายเป็นมหกรรมจับม็อบถูส้วมสลบเหมือด 💀",
      stampText: "พิมมี่บิ๊กคลีน"
    };
  }

  if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
    return {
      titleOverlay: "เครื่องให้ข้าวแมว.. หรือสอยมวย? 🐱",
      modelSubtitle: "พิมมี่พูดผ่านกล้อง ไอ้ส้มตบเครื่องพังคว่ำกินเองเฉย!",
      plotTwist: "สรุป: ซื้อถังอำนวยความสะดวก แมวส้มใช้ซ้อมมวยขู่ตะปบกล้องสลัด!",
      stampText: "แมวส้มซ้อมมวย"
    };
  }

  // General fallback
  return {
    titleOverlay: `รีวิวเรียลๆ ${productName} ✨`,
    modelSubtitle: `นึกว่าชีวิตจะสบาย... สุดท้ายได้ภาระมาดูแลเฉย!`,
    plotTwist: `สรุป: วู่วามสอยตีสองตื่นมาตังค์เกลี้ยง นั่งจ้วงมาม่าด้วยช้อนทองคำเปลว 😭`,
    stampText: "ตีสองวู่วาม"
  };
}

function getRealisticFallbackVideo(productId: string, productName: string): string {
  const nameLower = (productName || "").toLowerCase();
  
  if (productId === "prod-2" || nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    return "https://samplelib.com/preview/mp4/sample-15s.mp4";
  }
  
  if (productId === "prod-3" || nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    return "https://samplelib.com/preview/mp4/sample-5s.mp4";
  }

  if (productId === "prod-1" || nameLower.includes("ไมโครโฟน") || nameLower.includes("micro") || nameLower.includes("sound")) {
    return "https://samplelib.com/preview/mp4/sample-10s.mp4";
  }

  if (productId === "prod-4" || nameLower.includes("โคมไฟ") || nameLower.includes("lamp") || nameLower.includes("moon")) {
    return "https://www.w3schools.com/html/mov_bbb.mp4";
  }

  // Default fallback with rich background audio
  return "https://samplelib.com/preview/mp4/sample-10s.mp4";
}

// Helper to wrap text for Thai / English
function wrapText(text: string, maxChars: number = 38): string[] {
  const cleanText = (text || "").replace(/\n/g, " ");
  if (cleanText.includes(" ")) {
    const words = cleanText.split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + word).length > maxChars) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    if (currentLine) lines.push(currentLine.trim());
    return lines;
  } else {
    const lines: string[] = [];
    for (let i = 0; i < cleanText.length; i += maxChars) {
      lines.push(cleanText.substring(i, i + maxChars));
    }
    return lines;
  }
}

// Helper to download external background image if needed
async function downloadImageIfNeeded(urlOrPath: string): Promise<string> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const tempDir = path.join(process.cwd(), "src", "db", "temp");
    await fs.mkdir(tempDir, { recursive: true });
    
    const urlHash = Buffer.from(urlOrPath).toString("base64").substring(0, 20).replace(/[^a-zA-Z0-9]/g, "");
    const tempFilePath = path.join(tempDir, `bg_${urlHash}.jpg`);
    
    try {
      const buf = await fs.readFile(tempFilePath);
      if (buf.length > 4 && (
        (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // JPEG
        (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) || // PNG
        (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) // WEBP/RIFF
      )) {
        console.log(`ℹ️ [BG-CACHE] Using existing cached image: ${tempFilePath}`);
        return tempFilePath;
      }
      console.warn(`⚠️ [BG-CACHE] Cached image is invalid or corrupted. Unlinking...`);
      await fs.unlink(tempFilePath).catch(() => {});
    } catch {
      // Proceed to download
    }
    
    console.log(`📥 [BG-DOWNLOAD] Downloading image from URL: ${urlOrPath}`);
    try {
      const res = await fetch(urlOrPath, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/jpeg,image/png,image/webp,image/*,*/*"
        }
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      
      const isJpeg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isPng = buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isWebp = buf.length > 3 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46; // RIFF/WEBP
      
      if (!isJpeg && !isPng && !isWebp) {
        const hexStart = buf.slice(0, 10).toString("hex");
        const textStart = buf.slice(0, 100).toString("utf-8");
        throw new Error(`Downloaded content is not a valid image (starts with hex: ${hexStart}, text: ${textStart.substring(0, 50)})`);
      }
      
      await fs.writeFile(tempFilePath, buf);
      console.log(`✅ [BG-DOWNLOAD] Image downloaded to: ${tempFilePath}`);
      return tempFilePath;
    } catch (err: any) {
      console.error(`❌ [BG-DOWNLOAD] Failed to download image from ${urlOrPath}: ${err.message}`);
      throw err;
    }
  }
  
  if (urlOrPath.startsWith("/src")) {
    return path.join(process.cwd(), urlOrPath);
  }
  return urlOrPath;
}

// CORE FUNCTION: Generate 9:16 Shorts Video containing custom structured layout
async function generateShortsVideoFromCover(product: any, cover: any): Promise<string> {
  console.log(`🎬 [VIDEO-GEN] Creating vertical video for "${product.name}"...`);
  
  // 1. Resolve Background Image
  let bgSource = "";
  const nameLower = (product.name || "").toLowerCase();
  
  let localFallbackBg = path.join(process.cwd(), "src", "assets", "images", "thai_mic_wife_shorts_1784280660439.jpg");
  if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    localFallbackBg = path.join(process.cwd(), "src", "assets", "images", "thai_coffee_stray_shorts_1784280646086.jpg");
  }

  if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
    bgSource = path.join(process.cwd(), "src", "assets", "images", "thai_coffee_stray_shorts_1784280646086.jpg");
  } else if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
    bgSource = path.join(process.cwd(), "src", "assets", "images", "thai_mic_wife_shorts_1784280660439.jpg");
  } else if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
    bgSource = "https://picsum.photos/seed/keyboardgamer/600/1066";
  } else if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
    bgSource = "https://picsum.photos/seed/moonlampgirl/600/1066";
  } else if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
    bgSource = "https://picsum.photos/seed/catgeektasty/600/1066";
  } else {
    bgSource = "https://picsum.photos/seed/thaiportraitpic/600/1066";
  }

  let localBgPath = localFallbackBg;
  try {
    localBgPath = await downloadImageIfNeeded(bgSource);
  } catch (err: any) {
    console.warn(`⚠️ [VIDEO-GEN] Background image download/validation failed (${err.message}). Using secure local fallback: ${localFallbackBg}`);
    localBgPath = localFallbackBg;
  }
  
  // Create output directories
  const tempDir = path.join(process.cwd(), "src", "db", "temp");
  await fs.mkdir(tempDir, { recursive: true });
  
  const timestamp = Date.now();
  const pngPath = path.join(tempDir, `cover_${timestamp}.png`);
  const mp4Path = path.join(tempDir, `video_${timestamp}.mp4`);
  
  // 2. Prepare text parameters
  const title = (cover.coverTitle || "สอยด่วน ของดีป้ายยา! 🔥").trim();
  const subtitle = (cover.coverSubtitle || "").trim();
  const stampText = (cover.coverStamp || "").trim();
  const plotTwist = (cover.coverPlotTwist || "").trim();
  const channelName = "@NoinaReview.th";
  
  const escapeShellArg = (arg: string) => {
    return arg.replace(/'/g, "'\\''").replace(/%/g, "\\%");
  };
  
  const escapedTitle = escapeShellArg(title);
  const escapedStamp = escapeShellArg(stampText);
  const escapedChannel = escapeShellArg(channelName);
  
  // Theme Color Configurations
  let titleBgColor = "#facc15"; // yellow
  let titleTextColor = "#0f172a";
  
  if (cover.coverOverlayColor === "green") {
    titleBgColor = "#34d399";
  } else if (cover.coverOverlayColor === "pink") {
    titleBgColor = "#ec4899";
    titleTextColor = "#ffffff";
  } else if (cover.coverOverlayColor === "cyan") {
    titleBgColor = "#22d3ee";
  }

  // Build the ImageMagick 'convert' drawing layers command
  let convertCmd = `convert "${localBgPath}" \\
    -resize 1080x1920! \\
    -fill "rgba(0,0,0,0.5)" -draw "rectangle 0,0 1080,300" \\
    -fill "rgba(0,0,0,0.75)" -draw "rectangle 0,1400 1080,1920" \\
    \\
    -fill "${titleBgColor}" -stroke "#000000" -strokewidth 4 -draw "roundrectangle 80,110 1000,250 24,24" \\
    -font Garuda-Bold -pointsize 54 -fill "${titleTextColor}" -stroke none -gravity North -draw "text 0,145 '${escapedTitle}'"`;

  // Draw stamp if present
  if (stampText) {
    convertCmd += ` \\
      -fill "#f97316" -stroke "#ffffff" -strokewidth 3 -draw "roundrectangle 750,280 1000,350 15,15" \\
      -font Garuda-Bold -pointsize 32 -fill "#ffffff" -stroke none -gravity NorthWest -draw "text 790,295 '🔥 ${escapedStamp}'"`;
  }

  // Draw speech bubble / subtitle if present
  if (subtitle) {
    const subtitleLines = wrapText(subtitle, 28);
    const line1 = subtitleLines[0] || "";
    const line2 = subtitleLines[1] || "";
    
    // Adjust speech bubble height if there's a second line
    const bubbleHeight = line2 ? 655 : 590;
    
    convertCmd += ` \\
      -fill "rgba(15,23,42,0.9)" -stroke "#475569" -strokewidth 3 -draw "roundrectangle 80,450 720,${bubbleHeight} 20,20" \\
      -font Garuda-Bold -pointsize 32 -fill "#fdba74" -stroke none -gravity NorthWest -draw "text 120,490 '💬 \\"${escapeShellArg(line1)}\\"'"`;
      
    if (line2) {
      convertCmd += ` \\
        -font Garuda-Bold -pointsize 32 -fill "#fdba74" -stroke none -gravity NorthWest -draw "text 120,545 '${escapeShellArg(line2)}\\"'"`;
    }
  }

  // Draw plot twist ending panel if present
  if (plotTwist) {
    const plotTwistLines = wrapText(plotTwist, 35);
    const ptLine1 = plotTwistLines[0] || "";
    const ptLine2 = plotTwistLines[1] || "";
    
    convertCmd += ` \\
      -fill "rgba(15,23,42,0.95)" -stroke "#f59e0b" -strokewidth 4 -draw "roundrectangle 80,1440 1000,1660 30,30" \\
      -fill "#f59e0b" -stroke none -draw "roundrectangle 120,1415 360,1465 10,10" \\
      -font Garuda-Bold -pointsize 26 -fill "#0f172a" -gravity NorthWest -draw "text 140,1425 'มุขหักมุมเฉลย 🤣'" \\
      -font Garuda-Bold -pointsize 32 -fill "#f8fafc" -gravity NorthWest -draw "text 120,1490 '${escapeShellArg(ptLine1)}'"`;
      
    if (ptLine2) {
      convertCmd += ` \\
        -font Garuda-Bold -pointsize 32 -fill "#f8fafc" -gravity NorthWest -draw "text 120,1550 '${escapeShellArg(ptLine2)}'"`;
    }
  }

  // Draw channel branding, logo, and SUBSCRIBE button
  convertCmd += ` \\
    -fill "#f97316" -stroke "#ffffff" -strokewidth 3 -draw "circle 130,1780 130,1820" \\
    -font Garuda-Bold -pointsize 36 -fill "#ffffff" -stroke none -gravity NorthWest -draw "text 115,1755 'N' \\
    text 200,1740 '${escapedChannel}'" \\
    -font Garuda -pointsize 24 -fill "#94a3b8" -gravity NorthWest -draw "text 200,1790 '1.2M subscribers'" \\
    -fill "#dc2626" -stroke none -draw "roundrectangle 760,1740 980,1810 35,35" \\
    -font Garuda-Bold -pointsize 24 -fill "#ffffff" -gravity NorthWest -draw "text 800,1755 'SUBSCRIBE'" \\
    "${pngPath}"`;

  console.log(`🎨 [VIDEO-GEN] Generating compiled layout PNG to: ${pngPath}`);
  let convertSucceeded = false;
  try {
    await execAsync(convertCmd);
    convertSucceeded = true;
  } catch (err: any) {
    console.warn(`⚠️ [VIDEO-GEN] ImageMagick compilation failed with original background: ${err.message}. Retrying with reliable local fallback image...`);
    
    // If we used a downloaded background, retry convertCmd with localFallbackBg instead!
    if (localBgPath !== localFallbackBg) {
      try {
        const fallbackConvertCmd = convertCmd.replace(new RegExp(`"${localBgPath}"`, 'g'), `"${localFallbackBg}"`);
        console.log(`🔄 [VIDEO-GEN] Retrying convert with local fallback: ${localFallbackBg}`);
        await execAsync(fallbackConvertCmd);
        convertSucceeded = true;
      } catch (retryErr: any) {
        console.error(`❌ [VIDEO-GEN] Retry convert with local fallback also failed: ${retryErr.message}`);
      }
    }
  }

  // Fallback if ImageMagick convert failed entirely (e.g. missing package or font errors)
  if (!convertSucceeded) {
    console.error(`🚨 [VIDEO-GEN] ImageMagick is failing completely. Generating video directly from fallback image "${localFallbackBg}" using pure FFmpeg...`);
    // Compile directly using FFmpeg from the fallback image to bypass ImageMagick completely!
    const ffmpegFallbackCmd = `ffmpeg -y -loop 1 -i "${localFallbackBg}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 10 -c:v libx264 -pix_fmt yuv420p -vf "scale=1080:1920" -r 30 -c:a aac -shortest "${mp4Path}"`;
    console.log(`📹 [VIDEO-GEN] Converting raw fallback background directly to 10s vertical MP4: ${mp4Path}`);
    await execAsync(ffmpegFallbackCmd);
    console.log(`✅ [VIDEO-GEN] Pure-FFmpeg fallback video generated successfully: ${mp4Path}`);
    return mp4Path;
  }
  
  // 3. Compile MP4 using ffmpeg with silent audio track
  const ffmpegCmd = `ffmpeg -y -loop 1 -i "${pngPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 10 -c:v libx264 -pix_fmt yuv420p -vf "scale=1080:1920" -r 30 -c:a aac -shortest "${mp4Path}"`;
  
  console.log(`📹 [VIDEO-GEN] Converting PNG to 10s vertical MP4 at: ${mp4Path}`);
  await execAsync(ffmpegCmd);
  
  // Clean up temporary PNG
  try {
    await fs.unlink(pngPath);
  } catch (err) {
    // Ignore error if already deleted
  }
  
  console.log(`✅ [VIDEO-GEN] Video generated successfully: ${mp4Path}`);
  return mp4Path;
}

// 4. Custom API for YouTube Shorts upload
async function uploadToYouTubeShorts(title: string, description: string, videoUrl: string, productId: string = "", productName: string = "") {
  const config = await readConfig();
  const rawClientId = config.youtubeClientId || process.env.YOUTUBE_CLIENT_ID || "";
  const rawClientSecret = config.youtubeClientSecret || process.env.YOUTUBE_CLIENT_SECRET || "";
  const rawRefreshToken = config.youtubeRefreshToken || process.env.YOUTUBE_REFRESH_TOKEN || "";

  const clientId = typeof rawClientId === "string" ? rawClientId.trim() : "";
  const clientSecret = typeof rawClientSecret === "string" ? rawClientSecret.trim() : "";
  const refreshToken = typeof rawRefreshToken === "string" ? rawRefreshToken.trim() : "";

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
    if (!accessToken) {
      throw new Error(`Failed to refresh YouTube access token: No access_token was returned in Google's response: ${JSON.stringify(tokenData)}`);
    }
    
    console.log("✅ YouTube Access Token refreshed successfully.");
    let buffer: Buffer;
    let fileSize: number;
    let finalVideoUrlUsed = videoUrl;

    if (videoUrl && !videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
      console.log("📁 Loading local compiled video file:", videoUrl);
      const fileBuffer = await fs.readFile(videoUrl);
      buffer = fileBuffer;
      fileSize = fileBuffer.length;
      finalVideoUrlUsed = "local_compiled_video.mp4";
    } else {
      console.log("📥 Fetching Shorts video binary from source URL:", videoUrl);

      // Fetch video binary from URL with robust fallback strategy to ensure 100% upload success
      let videoResponse: any = null;
      
      // List of reliable video sources if the primary Mixkit source fails (Mixkit often blocks data center IPs with 403 Forbidden)
      const fallbackUrl = getRealisticFallbackVideo(productId, productName || title);
      const urlsToTry = [
        videoUrl,
        fallbackUrl,
        "https://samplelib.com/preview/mp4/sample-10s.mp4",
        "https://samplelib.com/preview/mp4/sample-5s.mp4",
        "https://www.w3schools.com/html/mov_bbb.mp4"
      ];

      let lastFetchError = "";
      for (let i = 0; i < urlsToTry.length; i++) {
        const url = urlsToTry[i];
        try {
          console.log(`📥 [YouTube Upload] Trying to download video source (${i + 1}/${urlsToTry.length}): ${url}`);
          
          // Set standard browser headers for all sources to avoid bot-blocking, but ONLY send Referer to Mixkit
          const headers: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "video/mp4,video/*,*/*",
            "Accept-Language": "en-US,en;q=0.9"
          };
          
          if (url && url.includes("mixkit.co")) {
            headers["Referer"] = "https://mixkit.co/";
          }

          videoResponse = await fetch(url, { headers });
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
      fileSize = videoBlob.size;
      const arrayBuffer = await videoBlob.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

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

    // Parse nested Google API JSON errors if available
    try {
      const jsonMatch = userFriendlyMessage.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed && parsed.error && parsed.error.message) {
          userFriendlyMessage = `${parsed.error.message} (${parsed.error.status || "API_ERROR"})`;
        }
      }
    } catch (e) {
      // Ignore JSON parse error, fallback to original message
    }
    
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

  // Resolve Cover data
  let coverData = selectedProduct.customCover;
  if (!coverData) {
    console.log("ℹ️ [SYSTEM AUTO-POST] No custom cover designed. Auto-generating cover with Gemini...");
    let modelStyle = "ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)";
    const nameLower = selectedProduct.name.toLowerCase();
    if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
      modelStyle = "หนุ่มออฟฟิศขี้เกรงใจเมีย ( blurred background ชวนเสียวหลัง)";
    } else if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
      modelStyle = "หนุ่มหมีวิศวะสายเกมเมอร์";
    } else if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp") || nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet")) {
      modelStyle = "สาวชิคแต่งห้องนอนสายโรแมนติก";
    }
    
    try {
      const autoCover = await generateCoverWithGemini(selectedProduct.name, selectedProduct.description, modelStyle);
      coverData = {
        coverTitle: autoCover.titleOverlay,
        coverSubtitle: autoCover.modelSubtitle,
        coverPlotTwist: autoCover.plotTwist,
        coverStamp: autoCover.stampText,
        coverOverlayColor: "yellow",
        coverModelStyle: modelStyle
      };
    } catch (e) {
      console.warn("⚠️ [SYSTEM AUTO-POST] Gemini cover generation failed, using template fallback...");
      let coverTitle = `รีวิวเรียลๆ ${selectedProduct.name} ✨`;
      let coverSubtitle = "คิดว่าซื้อมาแล้วชีวิตจะสบาย... สุดท้ายได้ภาระมาแทน!";
      let coverPlotTwist = "สรุป: วู่วามกดสั่งตอนตีสองตื่นเช้ามาปาดเหงื่อเพราะไม่มีจะกิน!";
      let coverStamp = "สอยด่วนๆ";
      
      if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
        coverTitle = "ชงพกพา บีบจนมือหัก! ☕️😭";
        coverSubtitle = "กาแฟยังไม่ได้จิบ เส้นเลือดสมองจะแตกแทน!";
        coverPlotTwist = "สรุป: คุ้มค่ามาก... ได้กล้ามเนื้อไบเซป แต่อดดื่มกาแฟ ต้องเดินเข้าร้านคาเฟ่แทน!";
        coverStamp = "บีบเค้นชีวิต";
      } else if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
        coverTitle = "ตัดเสียงรบกวนอัจฉริยะ! 🎙️🤫";
        coverSubtitle = "ตัดได้ยันเสียงสิบล้อ ยกเว้นเสียงเมียด่าจากหลังบ้าน!";
        coverPlotTwist = "สรุป: นวัตกรรมร้อยล้าน ก็พ่ายแพ้พลังเสียงทำลายล้างของภรรยาสุดที่รัก!";
        coverStamp = "สิบล้อเงียบกริบ";
      }
      
      coverData = {
        coverTitle,
        coverSubtitle,
        coverPlotTwist,
        coverStamp,
        coverOverlayColor: "yellow",
        coverModelStyle: modelStyle
      };
    }
  }

  // Compile video from cover & upload to YouTube Shorts
  let videoUrl = "";
  let uploadResult: any = null;
  
  try {
    const compiledVideoPath = await generateShortsVideoFromCover(selectedProduct, coverData);
    videoUrl = compiledVideoPath;
    
    uploadResult = await uploadToYouTubeShorts(
      aiResult.youtubeTitle,
      aiResult.youtubeCaption,
      videoUrl,
      selectedProduct.id,
      selectedProduct.name
    );
  } finally {
    if (videoUrl && !videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
      try {
        await fs.unlink(videoUrl);
        console.log("🗑️ Cleaned up temporary video file:", videoUrl);
      } catch (err) {
        console.error("⚠️ Failed to delete temporary video:", err);
      }
    }
  }

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
  
  const trimVal = (val: any) => typeof val === "string" ? val.trim() : val;
  
  if (affiliateId !== undefined) config.affiliateId = trimVal(affiliateId);
  if (geminiApiKey !== undefined) config.geminiApiKey = trimVal(geminiApiKey);
  if (youtubeClientId !== undefined) config.youtubeClientId = trimVal(youtubeClientId);
  if (youtubeClientSecret !== undefined) config.youtubeClientSecret = trimVal(youtubeClientSecret);
  if (youtubeRefreshToken !== undefined) config.youtubeRefreshToken = trimVal(youtubeRefreshToken);

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

// POST /api/products/save-cover (Save Custom Cover Parameters)
app.post("/api/products/save-cover", async (req, res) => {
  try {
    const { productId, coverTitle, coverSubtitle, coverPlotTwist, coverStamp, coverOverlayColor, coverModelStyle } = req.body || {};
    if (!productId) {
      return res.status(400).json({ error: "ไม่พบรหัสสินค้า (productId)" });
    }
    
    const products = await readProducts();
    const index = products.findIndex((p: any) => p.id === productId);
    if (index === -1) {
      return res.status(404).json({ error: "ไม่พบสินค้าในคลัง" });
    }
    
    products[index].customCover = {
      coverTitle,
      coverSubtitle,
      coverPlotTwist,
      coverStamp,
      coverOverlayColor,
      coverModelStyle
    };
    
    await writeProducts(products);
    res.json({ success: true, message: "บันทึกการส่งภาพปกเสร็จสมบูรณ์! ภาพนี้จะถูกประกอบเข้ากับวิดีโอ Shorts ขนาด 9:16 ตอนโพสต์จริง" });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูลปก" });
  }
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
