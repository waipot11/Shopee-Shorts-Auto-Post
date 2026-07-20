import React, { useState, useEffect } from "react";
import { 
  ShoppingBag, 
  Tv, 
  Settings, 
  Database, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Edit2, 
  ExternalLink, 
  Copy, 
  Check, 
  Clock, 
  Play, 
  Youtube, 
  Zap,
  Tag,
  Sparkles,
  Search,
  BookOpen,
  Eye,
  LogOut,
  Sliders,
  CheckCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Product {
  id: string;
  name: string;
  originalUrl: string;
  description: string;
  videoSource?: string;
  customCover?: {
    coverTitle?: string;
    coverSubtitle?: string;
    coverPlotTwist?: string;
    coverStamp?: string;
    coverOverlayColor?: string;
    coverModelStyle?: string;
  };
}

interface PostLog {
  id: string;
  timestamp: string;
  productId: string;
  productName: string;
  shopeeOriginalUrl: string;
  shopeeAffiliateUrl: string;
  youtubeTitle: string;
  youtubeCaption: string;
  purchaseScript?: string;
  youtubeVideoId: string;
  status: "SUCCESS" | "FAILED";
  videoSource: string;
  isSimulation: boolean;
  statusMessage?: string;
}

interface SystemConfig {
  affiliateId: string;
  cronExpression: string;
  hasGemini: boolean;
  hasYoutubeClientId: boolean;
  hasYoutubeClientSecret: boolean;
  hasYoutubeRefreshToken: boolean;
  activeMode: "REAL_YOUTUBE" | "SIMULATION";
  geminiApiKey?: string;
  youtubeClientId?: string;
  youtubeClientSecret?: string;
  youtubeRefreshToken?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "products" | "logs" | "setup">("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [logs, setLogs] = useState<PostLog[]>([]);
  const [config, setConfig] = useState<SystemConfig>({
    affiliateId: "15324930878",
    cronExpression: "0 9 * * *",
    hasGemini: false,
    hasYoutubeClientId: false,
    hasYoutubeClientSecret: false,
    hasYoutubeRefreshToken: false,
    activeMode: "SIMULATION"
  });

  // UI state variables
  const [isLoading, setIsLoading] = useState(false);
  const [shopeeInput, setShopeeInput] = useState("");
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");
  const [youtubeClientIdInput, setYoutubeClientIdInput] = useState("");
  const [youtubeClientSecretInput, setYoutubeClientSecretInput] = useState("");
  const [youtubeRefreshTokenInput, setYoutubeRefreshTokenInput] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Covers Designer State
  const [selectedProductIdForCover, setSelectedProductIdForCover] = useState<string>("prod-2");
  const [coverModelStyle, setCoverModelStyle] = useState<string>("ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)");
  const [coverTitle, setCoverTitle] = useState<string>("ชงพกพา บีบจนมือหัก! ☕️😭");
  const [coverSubtitle, setCoverSubtitle] = useState<string>("กาแฟยังไม่ได้จิบ เส้นเลือดสมองจะแตกแทน!");
  const [coverPlotTwist, setCoverPlotTwist] = useState<string>("สรุป: คุ้มค่ามาก... ได้กล้ามเนื้อแขน แต่อดแดกกาแฟ ต้องเดินไปซื้อคาเฟ่ให้เค้าชงให้แทน!");
  const [coverStamp, setCoverStamp] = useState<string>("บีบเค้นชีวิต");
  const [coverOverlayColor, setCoverOverlayColor] = useState<string>("yellow"); // yellow, green, pink, cyan
  const [isGeneratingCoverText, setIsGeneratingCoverText] = useState<boolean>(false);
  
  // Modal State for Product (Create/Edit)
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: "",
    originalUrl: "",
    description: "",
    videoSource: ""
  });

  // Manual trigger posting state
  const [triggeringPost, setTriggeringPost] = useState(false);
  const [triggerStep, setTriggerStep] = useState(0);
  const [lastPostedLog, setLastPostedLog] = useState<PostLog | null>(null);

  // Notifications
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showNotification = (text: string, type: "success" | "error" = "success") => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Fetch all initial data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [pRes, lRes, cRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/logs"),
        fetch("/api/config")
      ]);

      if (pRes.ok) setProducts(await pRes.json());
      if (lRes.ok) setLogs(await lRes.json());
      if (cRes.ok) {
        const configData = await cRes.json();
        setConfig(configData);
        setShopeeInput(configData.affiliateId);
        setGeminiApiKeyInput(configData.geminiApiKey || "");
        setYoutubeClientIdInput(configData.youtubeClientId || "");
        setYoutubeClientSecretInput(configData.youtubeClientSecret || "");
        setYoutubeRefreshTokenInput(configData.youtubeRefreshToken || "");
      }
    } catch (error) {
      console.error("Error fetching database information:", error);
      showNotification("ไม่สามารถดึงข้อมูลจากเซิร์ฟเวอร์หลังบ้านได้", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Save Config Affiliate ID and credentials
  const handleSaveConfig = async () => {
    if (!shopeeInput.trim()) {
      showNotification("กรุณาระบุ Shopee Affiliate ID", "error");
      return;
    }
    setIsSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          affiliateId: shopeeInput,
          geminiApiKey: geminiApiKeyInput,
          youtubeClientId: youtubeClientIdInput,
          youtubeClientSecret: youtubeClientSecretInput,
          youtubeRefreshToken: youtubeRefreshTokenInput
        })
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.config;
        setConfig(prev => ({ 
          ...prev, 
          affiliateId: updated.affiliateId,
          geminiApiKey: updated.geminiApiKey,
          youtubeClientId: updated.youtubeClientId,
          youtubeClientSecret: updated.youtubeClientSecret,
          youtubeRefreshToken: updated.youtubeRefreshToken,
          hasGemini: !!updated.geminiApiKey,
          hasYoutubeClientId: !!updated.youtubeClientId,
          hasYoutubeClientSecret: !!updated.youtubeClientSecret,
          hasYoutubeRefreshToken: !!updated.youtubeRefreshToken,
          activeMode: (updated.youtubeClientId && updated.youtubeClientSecret && updated.youtubeRefreshToken) ? "REAL_YOUTUBE" : "SIMULATION"
        }));
        showNotification("บันทึกการตั้งค่าเรียบร้อยแล้ว!");
        fetchData();
      } else {
        throw new Error();
      }
    } catch (err) {
      showNotification("เกิดข้อผิดพลาดในการบันทึกค่า", "error");
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Delete Product
  const handleDeleteProduct = async (id: string) => {
    if (!confirm("คุณต้องการลบคลิปสินค้าตัวนี้ออกจากคลังหรือไม่?")) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (res.ok) {
        setProducts(prev => prev.filter(p => p.id !== id));
        showNotification("ลบสินค้าออกจากคลังเรียบร้อยแล้ว");
      } else {
        throw new Error();
      }
    } catch (err) {
      showNotification("ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
    }
  };

  // Covers Designer Helper Functions
  const handleProductChangeForCover = (prodId: string) => {
    setSelectedProductIdForCover(prodId);
    const foundProd = products.find(p => p.id === prodId);
    if (!foundProd) return;

    if (foundProd.customCover) {
      setCoverModelStyle(foundProd.customCover.coverModelStyle || "ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)");
      setCoverTitle(foundProd.customCover.coverTitle || "");
      setCoverSubtitle(foundProd.customCover.coverSubtitle || "");
      setCoverPlotTwist(foundProd.customCover.coverPlotTwist || "");
      setCoverStamp(foundProd.customCover.coverStamp || "");
      setCoverOverlayColor(foundProd.customCover.coverOverlayColor || "yellow");
      return;
    }

    const nameLower = foundProd.name.toLowerCase();
    
    if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
      setCoverModelStyle("ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)");
      setCoverTitle("ชงพกพา บีบจนมือหัก! ☕️😭");
      setCoverSubtitle("กาแฟยังไม่ได้จิบ เส้นเลือดสมองจะแตกแทน!");
      setCoverPlotTwist("สรุป: คุ้มค่ามาก... ได้กล้ามเนื้อไบเซป แต่อดดื่มกาแฟ ต้องเดินเข้าร้านคาเฟ่แทน!");
      setCoverStamp("บีบเค้นชีวิต");
      setCoverOverlayColor("yellow");
    } else if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
      setCoverModelStyle("หนุ่มออฟฟิศขี้เกรงใจเมีย ( blurred background ชวนเสียวหลัง)");
      setCoverTitle("ตัดเสียงรบกวนอัจฉริยะ! 🎙️🤫");
      setCoverSubtitle("ตัดได้ยันเสียงสิบล้อ ยกเว้นเสียงเมียด่าจากหลังบ้าน!");
      setCoverPlotTwist("สรุป: นวัตกรรมร้อยล้าน ก็พ่ายแพ้พลังเสียงทำลายล้างของภรรยาสุดที่รัก!");
      setCoverStamp("สิบล้อเงียบกริบ");
      setCoverOverlayColor("pink");
    } else if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
      setCoverModelStyle("หนุ่มหมีวิศวะสายเกมเมอร์");
      setCoverTitle("พิมพ์มันส์สะใจ ข้างบ้านกำหมัด! ⌨️🔥");
      setCoverSubtitle("เสียงบลูสวิตช์ฟินจัด นึกว่ารบสงครามโลกครั้งที่สาม!");
      setCoverPlotTwist("สรุป: นั่งพิมพ์แชตคุยกับสาวเพลินๆ ข้างบ้านเตรียมนัดพวกมาถีบประตูส้วม!");
      setCoverStamp("ข้างบ้านกำหมัด");
      setCoverOverlayColor("green");
    } else if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
      setCoverModelStyle("สาวชิคแต่งห้องนอนสายโรแมนติก");
      setCoverTitle("ไฟโรแมนติก ทำชีวิตเปลี่ยน! 🌕💀");
      setCoverSubtitle("สว่างจ้าเกินไป แฟนเห็นเศษฝุ่นใต้เตียง สั่งกวาดถูบ้านยันรุ่งสาง!");
      setCoverPlotTwist("สรุป: กะชวนดินเนอร์โรแมนติก ต้องกลายเป็นมหกรรมกวาดถูบิ๊กคลีนนิ่งเดย์!");
      setCoverStamp("ขัดบ้านยันเช้า");
      setCoverOverlayColor("cyan");
    } else if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
      setCoverModelStyle("ทาสแมวผู้ยอมจำนนต่อเจ้านายส้มเกเร");
      setCoverTitle("อาหารแมวอัจฉริยะ.. หรือกระสอบทราย? 🐱🥊");
      setCoverSubtitle("จ่ายช้าวิเดียว ไอ้ส้มตบเครื่องคว่ำตักกินเองโคตรตึง!");
      setCoverPlotTwist("สรุป: ซื้อมาหวังช่วยทาสแบ่งเบาภาระ สรุปกลายเป็นเวทีมวยให้เจ้านาย!");
      setCoverStamp("ไอ้ส้มซ้อมมวย");
      setCoverOverlayColor("yellow");
    } else {
      // Custom product general template
      setCoverModelStyle("ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)");
      setCoverTitle(`รีวิวเรียลๆ ${foundProd.name} ✨`);
      setCoverSubtitle("คิดว่าซื้อมาแล้วชีวิตจะสบาย... สุดท้ายได้ภาระมาแทน!");
      setCoverPlotTwist("สรุป: วู่วามกดสั่งตอนตีสองตื่นเช้ามาปาดเหงื่อเพราะไม่มีจะกิน!");
      setCoverStamp("ตีสองวู่วาม");
      setCoverOverlayColor("yellow");
    }
  };

  const handleGenerateAICoverText = async () => {
    const foundProd = products.find(p => p.id === selectedProductIdForCover);
    if (!foundProd) {
      showNotification("กรุณาเลือกสินค้าที่ต้องการทำหน้าปก", "error");
      return;
    }

    setIsGeneratingCoverText(true);
    try {
      const res = await fetch("/api/generate-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: foundProd.name,
          productDesc: foundProd.description,
          modelStyle: coverModelStyle
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.cover) {
          setCoverTitle(data.cover.titleOverlay || "หัวข้อกวนๆ");
          setCoverSubtitle(data.cover.modelSubtitle || "คำสั้นในใจ");
          setCoverPlotTwist(data.cover.plotTwist || "สรุปหักมุม");
          setCoverStamp(data.cover.stampText || "ป้ายเหลือง");
          showNotification("🪄 ครีเอทคำปกสุดกวนและมุกหักมุมโดย Gemini สำเร็จแล้ว!");
        } else {
          throw new Error();
        }
      } else {
        throw new Error();
      }
    } catch (err) {
      showNotification("เกิดข้อผิดพลาดในการคิดคำปก กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsGeneratingCoverText(false);
    }
  };

  const [isSavingCover, setIsSavingCover] = useState<boolean>(false);

  const handleSaveCoverDesign = async () => {
    if (!selectedProductIdForCover) {
      showNotification("กรุณาเลือกสินค้าที่ต้องการบันทึกหน้าปก", "error");
      return;
    }

    setIsSavingCover(true);
    try {
      const res = await fetch("/api/products/save-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductIdForCover,
          coverTitle,
          coverSubtitle,
          coverPlotTwist,
          coverStamp,
          coverOverlayColor,
          coverModelStyle
        })
      });

      if (res.ok) {
        const data = await res.json();
        showNotification(data.message || "บันทึกการส่งภาพปกเสร็จสมบูรณ์!");
        
        // Refresh products list
        const pRes = await fetch("/api/products");
        if (pRes.ok) setProducts(await pRes.json());
      } else {
        const errData = await res.json();
        throw new Error(errData.error || "บันทึกไม่สำเร็จ");
      }
    } catch (err: any) {
      showNotification(err.message || "เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setIsSavingCover(false);
    }
  };

  const getCoverBgImage = () => {
    const foundProd = products.find(p => p.id === selectedProductIdForCover);
    if (!foundProd) return "https://picsum.photos/seed/defaultcover/600/1066";
    
    const nameLower = foundProd.name.toLowerCase();
    if (nameLower.includes("กาแฟ") || nameLower.includes("coffee") || nameLower.includes("espresso")) {
      return "/src/assets/images/thai_coffee_stray_shorts_1784280646086.jpg";
    }
    if (nameLower.includes("ไมโครโฟน") || nameLower.includes("microphone") || nameLower.includes("sound")) {
      return "/src/assets/images/thai_mic_wife_shorts_1784280660439.jpg";
    }
    if (nameLower.includes("คีย์บอร์ด") || nameLower.includes("keyboard") || nameLower.includes("typing")) {
      return "https://picsum.photos/seed/keyboardgamer/600/1066";
    }
    if (nameLower.includes("พระจันทร์") || nameLower.includes("moon") || nameLower.includes("lamp")) {
      return "https://picsum.photos/seed/moonlampgirl/600/1066";
    }
    if (nameLower.includes("สัตว์เลี้ยง") || nameLower.includes("pet") || nameLower.includes("feeder")) {
      return "https://picsum.photos/seed/catgeektasty/600/1066";
    }
    return "https://picsum.photos/seed/thaiportraitpic/600/1066";
  };

  // Open Add/Edit Product Modal
  const openProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setProductForm({
        name: product.name,
        originalUrl: product.originalUrl,
        description: product.description,
        videoSource: product.videoSource || ""
      });
    } else {
      setEditingProduct(null);
      setProductForm({
        name: "",
        originalUrl: "",
        description: "",
        videoSource: ""
      });
    }
    setShowProductModal(true);
  };

  // Submit Product Form
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name || !productForm.originalUrl || !productForm.description) {
      showNotification("กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน", "error");
      return;
    }

    try {
      const method = editingProduct ? "PUT" : "POST";
      const url = editingProduct ? `/api/products/${editingProduct.id}` : "/api/products";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productForm)
      });

      if (res.ok) {
        const savedProduct = await res.json();
        if (editingProduct) {
          setProducts(prev => prev.map(p => p.id === savedProduct.id ? savedProduct : p));
          showNotification("อัปเดตข้อมูลสินค้าในคลังแล้ว");
        } else {
          setProducts(prev => [...prev, savedProduct]);
          showNotification("เพิ่มสินค้าเข้าสู่คลังเก็บข้อมูลสำเร็จ!");
        }
        setShowProductModal(false);
      } else {
        throw new Error();
      }
    } catch (err) {
      showNotification("เกิดข้อผิดพลาดในการบันทึกข้อมูลสินค้า", "error");
    }
  };

  // Copy to clipboard helper
  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showNotification("คัดลอกลงคลิปบอร์ดแล้ว");
  };

  // Trigger automated post immediately
  const handleTriggerPost = async () => {
    if (products.length === 0) {
      showNotification("ไม่สามารถโพสต์ได้ เนื่องจากไม่มีสินค้าในคลังสินค้า", "error");
      return;
    }
    
    setTriggeringPost(true);
    setLastPostedLog(null);
    setTriggerStep(1);

    // Step 1: Picking Product (Simulate visual progression delay)
    setTimeout(() => {
      setTriggerStep(2); // Step 2: Formulating affiliate tracking link
      
      setTimeout(() => {
        setTriggerStep(3); // Step 3: Triggering Gemini Creative API
        
        setTimeout(async () => {
          setTriggerStep(4); // Step 4: Connecting YouTube Shorts Upload API
          
          try {
            const response = await fetch("/api/trigger-post", { method: "POST" });
            if (response.ok) {
              const data = await response.json();
              setLastPostedLog(data.log);
              setLogs(prev => [data.log, ...prev]);
              
              if (data.log.status === "FAILED") {
                setTriggerStep(-1); // Set to Error/Failed step
                showNotification(`โพสต์ล้มเหลว: ${data.log.statusMessage || "เกิดข้อผิดพลาดในการเชื่อมต่อ YouTube API"}`, "error");
              } else {
                setTriggerStep(5); // Step 5: Finished
                showNotification("ระบบอัปโหลดอัตโนมัติทำงานสำเร็จ!");
              }
            } else {
              const errData = await response.json();
              throw new Error(errData.error || "เกิดข้อผิดพลาดจาก API");
            }
          } catch (error: any) {
            console.error(error);
            setTriggerStep(-1); // Error state
            showNotification(`ทำงานล้มเหลว: ${error.message || "เกิดข้อผิดพลาดในการโพสต์"}`, "error");
          }
        }, 1500);
      }, 1500);
    }, 1500);
  };

  // Trigger automated post for a specific product immediately
  const handleTriggerSpecificProductPost = async (productId: string) => {
    setActiveTab("dashboard");
    setTriggeringPost(true);
    setLastPostedLog(null);
    setTriggerStep(1);

    // Step 1: Picking Product (Simulate visual progression delay)
    setTimeout(() => {
      setTriggerStep(2); // Step 2: Formulating affiliate tracking link
      
      setTimeout(() => {
        setTriggerStep(3); // Step 3: Triggering Gemini Creative API
        
        setTimeout(async () => {
          setTriggerStep(4); // Step 4: Connecting YouTube Shorts Upload API
          
          try {
            const response = await fetch("/api/trigger-post", { 
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productId })
            });
            if (response.ok) {
              const data = await response.json();
              setLastPostedLog(data.log);
              setLogs(prev => [data.log, ...prev]);
              
              if (data.log.status === "FAILED") {
                setTriggerStep(-1); // Set to Error/Failed step
                showNotification(`โพสต์ล้มเหลว: ${data.log.statusMessage || "เกิดข้อผิดพลาดในการเชื่อมต่อ YouTube API"}`, "error");
              } else {
                setTriggerStep(5); // Step 5: Finished
                showNotification("ระบบอัปโหลดอัตโนมัติทำงานสำเร็จ!");
              }
            } else {
              const errData = await response.json();
              throw new Error(errData.error || "เกิดข้อผิดพลาดจาก API");
            }
          } catch (error: any) {
            console.error(error);
            setTriggerStep(-1); // Error state
            showNotification(`ทำงานล้มเหลว: ${error.message || "เกิดข้อผิดพลาดในการโพสต์"}`, "error");
          }
        }, 1500);
      }, 1500);
    }, 1500);
  };

  return (
    <div id="root-container" className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
      
      {/* ⚠️ Top Alert Banner */}
      <div className="bg-gradient-to-r from-orange-600 to-amber-500 py-2.5 px-4 text-center text-xs font-medium tracking-wide flex items-center justify-center gap-2 text-white">
        <Sparkles className="w-4 h-4 animate-pulse text-yellow-200" />
        <span>ระบบบอทโพสต์คลิปและลิงก์นายหน้าอัตโนมัติ 100% ทุกเช้าเวลา 09:00 น. ผ่านระบบ Cron Job หลังบ้าน</span>
      </div>

      {/* Main Header Layout */}
      <header id="main-header" className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl shadow-lg shadow-orange-500/15">
              <Youtube className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Shopee Shorts Auto Poster</h1>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Active
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">ระบบจัดการและปล่อยคลิปนายหน้าอัตโนมัติเต็มรูปแบบ (Zero Human Action Required)</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Quick Stats overview */}
            <div className="hidden md:flex items-center gap-6 border-l border-slate-800 pl-6 text-right">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">คลังสินค้า</p>
                <p className="text-lg font-bold text-orange-500 font-mono">{products.length} รายการ</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">โพสต์สำเร็จแล้ว</p>
                <p className="text-lg font-bold text-emerald-400 font-mono">{logs.length} คลิป</p>
              </div>
            </div>
          </div>

        </div>
      </header>

      {/* Sub Header / Control and Setup Info */}
      <div className="bg-slate-900 border-b border-slate-800/60 py-4 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={() => setActiveTab("dashboard")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "dashboard" 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Zap className="w-4 h-4" /> แผงควบคุม (Dashboard)
            </button>
            <button 
              onClick={() => setActiveTab("products")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "products" 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <ShoppingBag className="w-4 h-4" /> คลังเก็บสินค้า ({products.length})
            </button>
            <button 
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "logs" 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Database className="w-4 h-4" /> รายงานและประวัติโพสต์ ({logs.length})
            </button>
            <button 
              onClick={() => setActiveTab("covers")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "covers" 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" /> ออกแบบภาพปก (Shorts Cover)
            </button>
            <button 
              onClick={() => setActiveTab("setup")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "setup" 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Settings className="w-4 h-4" /> การเชื่อมต่อหลังบ้าน
            </button>
          </div>

          {/* Quick Refresh Icon */}
          <button 
            onClick={fetchData} 
            disabled={isLoading}
            className="self-start md:self-auto p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition duration-150 disabled:opacity-40"
            title="รีเฟรชข้อมูลสินค้าและล็อกโพสต์"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-orange-500" : ""}`} />
          </button>
          
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Floating Notification */}
        <AnimatePresence>
          {notification && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-24 right-4 z-50 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 font-medium text-sm border ${
                notification.type === "success" 
                  ? "bg-emerald-950/90 text-emerald-400 border-emerald-500/30" 
                  : "bg-red-950/90 text-red-400 border-red-500/30"
              }`}
            >
              {notification.type === "success" ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
              <span>{notification.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LOADING SHIMMER */}
        {isLoading && products.length === 0 && (
          <div className="space-y-4 py-12">
            <div className="h-10 bg-slate-900 rounded-2xl animate-pulse w-1/4"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="h-44 bg-slate-900 rounded-3xl animate-pulse"></div>
              <div className="h-44 bg-slate-900 rounded-3xl animate-pulse"></div>
              <div className="h-44 bg-slate-900 rounded-3xl animate-pulse"></div>
            </div>
          </div>
        )}

        {/* TAB 1: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            
            {/* System Config Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Card A: Account Info */}
              <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[180px]">
                <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] text-orange-500">
                  <Tag className="w-36 h-36" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs text-slate-400 uppercase tracking-widest font-mono">SHOPEE ACCOUNT</span>
                    <span className="px-2.5 py-1 text-[10px] font-bold text-orange-400 bg-orange-500/10 rounded-full border border-orange-500/20 uppercase">
                      Shopee Partner
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-slate-300">รหัสบัญชีนายหน้า (Affiliate ID)</h3>
                  <div className="mt-3 flex items-center gap-2">
                    <input 
                      type="text" 
                      value={shopeeInput} 
                      onChange={(e) => setShopeeInput(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 font-mono w-full"
                      placeholder="เช่น 15324930878"
                    />
                    <button 
                      onClick={handleSaveConfig} 
                      disabled={isSavingConfig}
                      className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 text-xs font-semibold rounded-xl transition duration-150 whitespace-nowrap"
                    >
                      {isSavingConfig ? "บันทึก..." : "อัปเดต ID"}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-3">ระบบจะพ่วงต่อรหัสนี้ต่อท้ายทุกลิงก์สินค้าที่เลือกอัปโหลดแบบ 100%</p>
              </div>

              {/* Card B: Cron Job Setup Info */}
              <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[180px]">
                <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] text-amber-500">
                  <Calendar className="w-36 h-36" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs text-slate-400 uppercase tracking-widest font-mono">AUTOMATION CRON</span>
                    <span className="px-2.5 py-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 rounded-full border border-amber-500/20 uppercase flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Scheduled
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-slate-300">ตารางเวลาสุ่มโพสต์อัตโนมัติ</h3>
                  <p className="text-lg font-bold text-white mt-1.5 flex items-center gap-2">
                    <span>ทุกเช้าเวลา 09:00 น.</span>
                    <span className="text-xs font-normal text-slate-400 font-mono">(Cron: 0 9 * * *)</span>
                  </p>
                </div>
                <div className="mt-4 text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800/40">
                  บอทจะตื่นขึ้นมาเวลา 09:00 น. แล้วทำการสุ่มสินค้า 1 ชิ้นจากคลัง, สร้างแคปชันด้วย AI และอัปโหลดขึ้น YouTube ทันทีโดยไม่ต้องกดยืนยัน
                </div>
              </div>

              {/* Card C: Tech Stack Connectivity */}
              <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[180px]">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-slate-400 uppercase tracking-widest font-mono">INTEGRATIONS</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full border border-emerald-500/20 font-mono">
                      {config.activeMode === "REAL_YOUTUBE" ? "LIVE API" : "SIMULATION"}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-slate-300">สถานะการเชื่อมต่อ API หลังบ้าน</h3>
                  
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Gemini AI API (คำยายตลก)</span>
                      <span className="font-semibold flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> เชื่อมต่อแล้ว (3.5-Flash)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">YouTube Data API (อัปโหลด)</span>
                      {config.hasYoutubeRefreshToken ? (
                        <span className="font-semibold flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" /> เปิดใช้งาน (Refresh Token)
                        </span>
                      ) : (
                        <span className="font-semibold flex items-center gap-1 text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5 animate-pulse" /> โหมดจำลองความสำเร็จ
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 mt-3 leading-tight">
                  {config.hasYoutubeRefreshToken 
                    ? "วิดีโอ Shorts จะอัปโหลดขึ้นช่อง YouTube จริงๆ ผ่าน API สิทธิ์ถาวร" 
                    : "⚠️ คุณสามารถรันจำลองการสุ่มโพสต์และ AI ได้อย่างราบรื่น หากต้องการรันระบบส่งขึ้น YouTube จริงให้ใส่ คีย์ของ YouTube ในหน้าการตั้งค่า"}
                </p>
              </div>

            </div>

            {/* Core Action Panel: Manual Trigger Post with Interactive Stepper */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 rounded-3xl p-8 relative overflow-hidden">
              <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 w-96 h-96 bg-orange-500/5 blur-[100px] rounded-full"></div>
              
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 text-orange-500 text-xs font-bold uppercase tracking-widest font-mono">
                  <Zap className="w-4 h-4 text-orange-500" />
                  <span>Manual System Action</span>
                </div>
                <h2 className="text-2xl font-black text-white mt-2">ทดสอบเรียกทำงานบอทสุ่มอัปโหลดด่วน</h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                  ถึงแม้ระบบจะรันตัวเองอัตโนมัติ 100% ทุกวัน แต่คุณสามารถสั่งให้บอท "ตื่นตัว" ขึ้นมาเพื่อทำการสุ่มสินค้า เขียนสคริปต์ฮาๆ และโพสต์ลง Shorts ตอนนี้เลยได้ทันทีโดยไม่ต้องรอเวลา เพื่อทดสอบและส่งผลงานด่วน
                </p>

                {/* Posting Control Button */}
                {!triggeringPost && (
                  <button 
                    onClick={handleTriggerPost}
                    className="mt-6 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold px-8 py-4 rounded-2xl shadow-xl shadow-orange-500/20 hover:shadow-orange-500/30 transition-all duration-150 transform active:scale-95 flex items-center gap-3"
                  >
                    <Play className="w-5 h-5 fill-current" /> สั่งบอททำงานทันที (สุ่ม เจน อัปโหลด 100%)
                  </button>
                )}

                {/* Animated Stepper Progress */}
                {triggeringPost && (
                  <div className="mt-8 bg-slate-950/80 rounded-2xl border border-slate-800 p-6 space-y-6">
                    <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-orange-500 animate-spin" />
                      <span>บอทกำลังดำเนินขั้นตอนอัจฉริยะ (โปรดรอสักครู่)...</span>
                    </h3>

                    {/* Stepper Steps UI */}
                    <div className="space-y-4 font-mono text-xs">
                      {/* Step 1 */}
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          triggerStep > 1 ? "bg-emerald-500 text-slate-950" : triggerStep === 1 ? "bg-orange-500 text-white animate-pulse" : "bg-slate-800 text-slate-500"
                        }`}>
                          {triggerStep > 1 ? "✔" : "1"}
                        </div>
                        <div className={triggerStep === 1 ? "text-orange-400 font-semibold" : triggerStep > 1 ? "text-slate-400" : "text-slate-600"}>
                          สุ่มเลือกสินค้าชิ้นเด่นอย่างชาญฉลาดจากคลังสินค้าสำรอง...
                        </div>
                      </div>

                      {/* Step 2 */}
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          triggerStep > 2 ? "bg-emerald-500 text-slate-950" : triggerStep === 2 ? "bg-orange-500 text-white animate-pulse" : "bg-slate-800 text-slate-500"
                        }`}>
                          {triggerStep > 2 ? "✔" : "2"}
                        </div>
                        <div className={triggerStep === 2 ? "text-orange-400 font-semibold" : triggerStep > 2 ? "text-slate-400" : "text-slate-600"}>
                          ต่อพ่วงลิงก์ยาว Shopee ผสานเข้ากับ Affiliate ID ({config.affiliateId})...
                        </div>
                      </div>

                      {/* Step 3 */}
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          triggerStep > 3 ? "bg-emerald-500 text-slate-950" : triggerStep === 3 ? "bg-orange-500 text-white animate-pulse" : "bg-slate-800 text-slate-500"
                        }`}>
                          {triggerStep > 3 ? "✔" : "3"}
                        </div>
                        <div className={triggerStep === 3 ? "text-orange-400 font-semibold" : triggerStep > 3 ? "text-slate-400" : "text-slate-600"}>
                          ส่งข้อมูลให้ AI (Gemini-3.5-flash) เจนแคปชันตลก แฮชแท็ก และสคริปต์สั้น...
                        </div>
                      </div>

                      {/* Step 4 */}
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          triggerStep > 4 ? "bg-emerald-500 text-slate-950" : triggerStep === 4 ? "bg-orange-500 text-white animate-pulse" : "bg-slate-800 text-slate-500"
                        }`}>
                          {triggerStep > 4 ? "✔" : "4"}
                        </div>
                        <div className={triggerStep === 4 ? "text-orange-400 font-semibold" : triggerStep > 4 ? "text-slate-400" : "text-slate-600"}>
                          ดึงมีเดียไฟล์ และส่งสคริปต์ยิงโพสต์เข้า YouTube Data API...
                        </div>
                      </div>

                      {/* Step 5 */}
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          triggerStep === 5 ? "bg-emerald-500 text-slate-950" : triggerStep === -1 ? "bg-red-500 text-white" : "bg-slate-800 text-slate-500"
                        }`}>
                          {triggerStep === 5 ? "✔" : triggerStep === -1 ? "❌" : "5"}
                        </div>
                        <div className={triggerStep === 5 ? "text-emerald-400 font-bold" : triggerStep === -1 ? "text-red-400" : "text-slate-600"}>
                          {triggerStep === 5 ? "อัปโหลดโพสต์และบันทึกสถิติสำเร็จเรียบร้อย! 🎉" : triggerStep === -1 ? "การโพสต์ล้มเหลว ตรวจสอบสาเหตุ" : "ปักหมุดลิงก์ ปิดจ๊อบ 100%!"}
                        </div>
                      </div>
                    </div>

                    {/* Show results card inside stepper */}
                    {triggerStep === 5 && lastPostedLog && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-slate-900 border border-emerald-500/20 p-5 rounded-xl space-y-4 mt-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-wider">
                            คลิปที่อัปโหลดสำเร็จล่าสุด
                          </span>
                          <span className="text-xs text-slate-500 font-mono">
                            ID: {lastPostedLog.youtubeVideoId}
                          </span>
                        </div>
                        
                        <div>
                          <p className="text-xs text-slate-400 font-mono">สินค้าที่ถูกสุ่มเลือก:</p>
                          <p className="text-sm font-bold text-white mt-1">{lastPostedLog.productName}</p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 font-mono">แคปชันโพสต์ที่ Gemini เจนให้:</p>
                          <p className="text-xs text-slate-300 mt-1.5 whitespace-pre-line bg-slate-950 p-3 rounded-lg border border-slate-800/80 font-mono max-h-36 overflow-y-auto leading-relaxed">
                            {lastPostedLog.youtubeCaption}
                          </p>
                        </div>

                        {lastPostedLog.purchaseScript && (
                          <div>
                            <p className="text-xs text-slate-400 font-mono">สคริปต์พากย์เสียง 15s โดย AI:</p>
                            <p className="text-xs text-orange-400 italic mt-1 bg-slate-950 p-2.5 rounded-lg border border-slate-800/50">
                              "{lastPostedLog.purchaseScript}"
                            </p>
                          </div>
                        )}

                        {lastPostedLog.isSimulation && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-400 space-y-1 font-sans">
                            <p className="font-bold flex items-center gap-1.5 text-amber-400">
                              <AlertCircle className="w-4 h-4" />
                              <span>ระบบทำงานในโหมดจำลอง (Simulation Mode)</span>
                            </p>
                            <p className="leading-relaxed text-slate-300">
                              เนื่องจากบัญชีนี้ยังไม่ได้เชื่อมต่อ YouTube Data API หรือเซ็ตค่า OAuth สำเร็จ ระบบจึงจำลองการอัปโหลดสำเร็จ (จำลอง Video ID เสมือนจริง) เพื่อทดสอบเวิร์กโฟลว์ หากเปิดลิงก์ YouTube ด้านล่างจะพบหน้า 404 (ไม่พบหน้าเว็บ) ซึ่งเป็นเรื่องปกติสำหรับการจำลอง!
                            </p>
                            <p className="pt-1 text-[11px] text-amber-300 font-medium">
                              👉 หากต้องการอัปโหลดขึ้น YouTube ของคุณจริงๆ กรุณากรอกรหัสและคีย์ในแท็บ <strong>"การเชื่อมต่อหลังบ้าน"</strong> ให้เรียบร้อย
                            </p>
                          </div>
                        )}

                        <div className="pt-2 flex flex-wrap items-center gap-3">
                          {lastPostedLog.isSimulation ? (
                            <span 
                              title="ไม่สามารถเปิดได้จริงเนื่องจากเป็นโหมดจำลอง (หน้า YouTube จะ 404)"
                              className="bg-slate-800 text-slate-500 cursor-not-allowed font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 border border-slate-700"
                            >
                              <Youtube className="w-3.5 h-3.5" /> ดูวิดีโอบน YouTube (เปิดไม่ได้ในโหมดจำลอง)
                            </span>
                          ) : (
                            <a 
                              href={`https://www.youtube.com/shorts/${lastPostedLog.youtubeVideoId}`} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition"
                            >
                              <Youtube className="w-3.5 h-3.5" /> ดูวิดีโอบน YouTube
                            </a>
                          )}
                          <button 
                            onClick={() => setTriggeringPost(false)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition"
                          >
                            ทำรายการใหม่
                          </button>
                        </div>
                      </motion.div>
                    )}

                     {triggerStep === -1 && (
                      <div className="space-y-4">
                        {lastPostedLog && lastPostedLog.statusMessage && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-red-400 space-y-1 font-sans">
                            <p className="font-bold flex items-center gap-1.5 text-red-400">
                              <AlertCircle className="w-4 h-4" />
                              <span>การอัปโหลดโพสต์ล้มเหลว (Upload Failed)</span>
                            </p>
                            <p className="leading-relaxed text-slate-300">
                              {lastPostedLog.statusMessage}
                            </p>
                            <p className="pt-2 text-[11px] text-red-300 font-medium leading-relaxed">
                              💡 คำแนะนำ: หากปัญหาเกิดจากสิทธิ์ (Unauthorized) หรือการขาดช่อง YouTube กรุณาเปิดเว็บไซต์ <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" className="underline text-orange-400 hover:text-orange-300">studio.youtube.com</a> ด้วยบัญชี Google ที่นำมาผูก เพื่อตรวจสอบว่าคุณได้สร้างช่อง (Channel) เรียบร้อยแล้วหรือไม่
                            </p>
                          </div>
                        )}
                        <div className="pt-2 flex gap-3">
                          <button 
                            onClick={handleTriggerPost}
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-lg text-xs transition"
                          >
                            ลองรันใหม่อีกครั้ง
                          </button>
                          <button 
                            onClick={() => setTriggeringPost(false)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>
            </div>

            {/* Dashboard List Overview: Last 3 Upload Logs */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-orange-500" />
                  <span>รายงานสถิติการอัปโหลดล่าสุด (Recent Action Feed)</span>
                </h3>
                <button 
                  onClick={() => setActiveTab("logs")}
                  className="text-xs text-orange-500 hover:text-orange-400 font-semibold flex items-center gap-1"
                >
                  ดูทั้งหมด ({logs.length}) <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {logs.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center text-slate-500 text-sm">
                  ไม่มีประวัติการโพสต์ปรากฏ โปรดลองสั่งโพสต์คลิปทันที!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {logs.slice(0, 2).map((log) => (
                    <div key={log.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition duration-150 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {new Date(log.timestamp).toLocaleString("th-TH")}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase ${
                            log.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}>
                            {log.status === "SUCCESS" ? (log.isSimulation ? "Simulation" : "SUCCESS") : "FAILED"}
                          </span>
                        </div>

                        <div>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">สินค้าหลัก</p>
                          <h4 className="text-sm font-bold text-white mt-0.5 truncate">{log.productName}</h4>
                        </div>

                        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 font-mono text-xs">
                          <p className="text-orange-400 font-bold truncate">{log.youtubeTitle}</p>
                          <p className="text-slate-400 mt-2 line-clamp-3 leading-relaxed whitespace-pre-line">{log.youtubeCaption}</p>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col gap-2">
                        {log.isSimulation && (
                          <div className="text-[10px] text-amber-500 bg-amber-500/5 px-2.5 py-1.5 rounded-lg border border-amber-500/10 font-sans">
                            ⚠️ โพสต์จำลอง (สุ่มสำเร็จ/เขียนสคริปต์เรียบร้อย) ลิงก์ด้านขวาจะไม่พบบนคลิปจริง หากต้องการโพสต์ช่องจริงให้เชื่อมต่อ API ในแท็บตั้งค่า
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <a 
                            href={log.shopeeAffiliateUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-orange-500 hover:underline flex items-center gap-1 font-mono font-medium truncate max-w-[200px]"
                          >
                            <Tag className="w-3.5 h-3.5 flex-shrink-0" />
                            {log.shopeeAffiliateUrl}
                          </a>
                          {log.isSimulation ? (
                            <span className="text-amber-500 font-bold flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 rounded-lg">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>วิดีโอจำลอง</span>
                            </span>
                          ) : (
                            <a 
                              href={`https://www.youtube.com/shorts/${log.youtubeVideoId}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-red-500 hover:underline flex items-center gap-1 font-semibold flex-shrink-0"
                            >
                              <Youtube className="w-4 h-4 text-red-500" />
                              ดูวิดีโอ Shorts
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 2: PRODUCTS INVENTORY */}
        {activeTab === "products" && (
          <div className="space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-orange-500" />
                  <span>คลังเก็บข้อมูลสินค้าสำรอง (Products Inventory)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">คลังใส่ข้อมูลรายชื่อสินค้า รายละเอียด ลิงก์ตัวเต็ม และพิกัดวิดีโอ Shorts ล่วงหน้าที่ต้องการทำคลิป</p>
              </div>

              <button 
                onClick={() => openProductModal()}
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition flex items-center gap-2 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" /> เพิ่มสินค้าเข้าคลัง
              </button>
            </div>

            {/* List products */}
            {products.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm">
                คลังเก็บสินค้าว่างเปล่า กรุณากด "เพิ่มสินค้าเข้าคลัง" เพื่อสร้างคลังจำลองของคุณไว้สำหรับรันระบบออโต้!
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {products.map((product) => (
                  <div key={product.id} className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 hover:border-slate-700 transition flex flex-col justify-between space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md font-mono text-[10px]">
                            ID: {product.id}
                          </span>
                          <h3 className="text-md font-bold text-white leading-snug">{product.name}</h3>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button 
                            onClick={() => openProductModal(product)}
                            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
                            title="แก้ไขสินค้า"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-red-400 rounded-lg transition"
                            title="ลบสินค้า"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed bg-slate-950 p-3.5 rounded-2xl border border-slate-800/60">
                        <span className="font-bold text-slate-400">คำอธิบายของดี:</span> {product.description}
                      </p>

                      <div className="space-y-2 font-mono text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">ลิงก์ Shopee ตัวเต็ม:</span>
                          <a 
                            href={product.originalUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-orange-500 hover:underline max-w-[260px] truncate flex items-center gap-1"
                          >
                            {product.originalUrl} <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">พารามิเตอร์นายหน้าบอท:</span>
                          <span className="text-slate-300 font-bold text-[11px] bg-slate-800 px-2 py-0.5 rounded border border-slate-700/60">
                            ?utm_source=affiliate&aff_id={config.affiliateId}
                          </span>
                        </div>
                        {product.videoSource && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">มีเดียคลิปตัวอย่าง (Shorts):</span>
                            <span className="text-slate-400 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded truncate max-w-[220px]" title={product.videoSource}>
                              {product.videoSource.split("/").pop()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Left: preview or status */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                          พร้อมอัปโหลด
                        </span>
                        {product.videoSource && (
                          <a 
                            href={product.videoSource} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white text-xs flex items-center gap-1 border-l border-slate-800 pl-3"
                          >
                            <Eye className="w-3.5 h-3.5" /> พรีวิววิดีโอ
                          </a>
                        )}
                      </div>

                      {/* Right: Trigger specific post button */}
                      <button
                        onClick={() => handleTriggerSpecificProductPost(product.id)}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all duration-150 transform active:scale-95 shadow-md shadow-orange-500/10"
                      >
                        <Zap className="w-3.5 h-3.5" /> โพสต์สินค้าชิ้นนี้ทันที
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* TAB 3: ACTIVITY UPLOAD LOGS */}
        {activeTab === "logs" && (
          <div className="space-y-6">
            
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-orange-500" />
                <span>รายงานสถานะการอัปโหลดและประวัติ (Post Activity Logs)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">ประวัติการทำงานของบอทอัปโหลดคลิปทั้งการสุ่มเวลา 09:00 น. หรือสั่งโพสต์ด้วยตัวเอง</p>
            </div>

            {logs.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm">
                ไม่มีประวัติโพสต์ปรากฏในระบบ
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 hover:border-slate-700 transition">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                      
                      <div className="space-y-4 flex-1">
                        {/* Status bar */}
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span className="font-mono text-slate-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {new Date(log.timestamp).toLocaleString("th-TH")}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] tracking-wide uppercase border ${
                            log.status === "SUCCESS" 
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                              : "bg-red-500/10 text-red-400 border-red-500/20"
                          }`}>
                            {log.status === "SUCCESS" ? "SUCCESS" : "FAILED"}
                          </span>
                          {log.isSimulation && (
                            <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full text-[10px] font-bold">
                              Simulation Mode
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">สินค้าหลักที่ระบบหยิบขึ้นมา</p>
                          <h4 className="text-base font-bold text-white mt-0.5">{log.productName}</h4>
                        </div>

                        {/* Title and Caption Details */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono mb-1.5 flex items-center gap-1">
                              <Tag className="w-3 h-3 text-orange-500" /> หัวข้อที่โพสต์ลง YouTube (Shorts Title)
                            </p>
                            <p className="text-xs font-bold text-white leading-relaxed font-mono">{log.youtubeTitle}</p>
                          </div>
                          
                          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono mb-1.5 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-orange-500" /> สคริปต์พากย์คลิปโดย AI
                            </p>
                            <p className="text-xs italic text-orange-400 font-mono">
                              "{log.purchaseScript || "ระบบ AI ไม่ได้เปิดสคริปต์แยก"}"
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 relative">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono mb-2 flex items-center gap-1 justify-between">
                            <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-orange-500" /> คำบรรยายและลิงก์ปักหมุดนายหน้า (Video Description)</span>
                            <button 
                              onClick={() => copyText(log.youtubeCaption, log.id)} 
                              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                              title="คัดลอกแคปชันไปโพสต์เองสำรอง"
                            >
                              {copiedId === log.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </p>
                          <p className="text-xs text-slate-300 leading-relaxed font-mono whitespace-pre-line max-h-48 overflow-y-auto">
                            {log.youtubeCaption}
                          </p>
                        </div>
                      </div>

                      {/* Video actions and short ID view */}
                      <div className="w-full lg:w-64 bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4 font-mono text-xs">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-slate-400">
                            <Youtube className="w-4 h-4 text-red-500" />
                            <span className="font-bold">YouTube Details</span>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Video ID:</span>
                              <span className="text-slate-300 font-semibold">{log.youtubeVideoId}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span>ประเภทโพสต์:</span>
                              <span className="text-orange-400 font-bold">YouTube Shorts</span>
                            </div>
                            {log.statusMessage && (
                              <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 leading-normal">
                                <span className="font-bold text-slate-500 block">รายงานจาก YouTube:</span>
                                {log.statusMessage}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-slate-800 space-y-2">
                          {log.isSimulation ? (
                            <span 
                              title="ไม่สามารถเปิดได้จริงเนื่องจากเป็นโหมดจำลอง (หน้า YouTube จะ 404)"
                              className="w-full bg-slate-800 text-slate-500 cursor-not-allowed font-bold py-2 rounded-xl text-center text-xs block border border-slate-700"
                            >
                              วิดีโอจำลอง (เปิดจริงไม่ได้)
                            </span>
                          ) : (
                            <a 
                              href={`https://www.youtube.com/shorts/${log.youtubeVideoId}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-center text-xs block transition"
                            >
                              เปิดเล่นวิดีโอ Shorts
                            </a>
                          )}
                          <a 
                            href={log.shopeeAffiliateUrl}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 rounded-xl text-center text-xs block transition"
                          >
                            ตรวจสอบลิงก์นายหน้า
                          </a>
                        </div>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* TAB: SHORTS COVERS DESIGNER STUDIO */}
        {activeTab === "covers" && (
          <div className="space-y-8">
            
            {/* Header banner */}
            <div className="bg-gradient-to-r from-orange-600/90 to-amber-500/90 border border-orange-500/30 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-2xl">
              <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-white/10 blur-3xl rounded-full"></div>
              <div className="max-w-3xl space-y-2 relative">
                <span className="px-3 py-1 bg-white/20 text-white rounded-full font-bold text-[10px] tracking-widest uppercase inline-block">
                  Covers Studio v1.0
                </span>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight">เครื่องมือออกแบบภาพปก YouTube Shorts ดักยอดวิวกวนๆ</h2>
                <p className="text-orange-100 text-sm leading-relaxed">
                  สร้างความสะดุดตาตั้งแต่เสี้ยววินาทีแรก! ออกแบบคำโปรยรีวิวกวนๆ แสบๆ พร้อมเลือกนายแบบ-นางแบบคนไทยสไตล์บ้านๆ หน้าซื่อตาใส และขยี้จุดจบด้วยมุขตลกหักมุมสุดพีคเพื่อดักยอดวิวกระจายแบบนักรีวิวมือทอง!
                </p>
              </div>
            </div>

            {/* Main content grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Form controls (Lg: 7 cols) */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
                
                <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-orange-500" /> ปรับแต่งพารามิเตอร์ปก (Designer Settings)
                </h3>

                {/* Select Product */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                    1. เลือกสินค้าในคลังสำหรับทำหน้าปก *
                  </label>
                  <select
                    value={selectedProductIdForCover}
                    onChange={(e) => handleProductChangeForCover(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500"
                  >
                    <option value="" disabled>-- เลือกสินค้าคลังนายหน้าของคุณ --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Model Persona description and selection list */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                    2. เลือกคาแร็กเตอร์นายแบบ/นางแบบไทยสไตล์เรียลๆ (หน้าตาบ้านๆ)
                  </label>
                  
                  <div className="grid grid-cols-2 gap-3.5 pt-1">
                    {[
                      {
                        style: "ชายไทยกรุงเทพสู้ชีวิต (หนุ่มสู้ชีวิตหน้าตาบ้านๆ)",
                        desc: "กวาดบ้าน หน้าหยาดเหงื่อ สู้ชีวิตแต่ชีวิตสู้กลับ",
                        label: "🧔‍♂️ หนุ่มสู้ชีวิตคนซื่อ"
                      },
                      {
                        style: "หนุ่มออฟฟิศขี้เกรงใจเมีย ( blurred background ชวนเสียวหลัง)",
                        desc: "เกรงอกเกรงใจ ยอมรับชะตากรรม หวาดระแวงเมียตื่นตูม",
                        label: "🤵‍♂️ มนุษย์ผัวผู้ซื่อสัตย์"
                      },
                      {
                        style: "หนุ่มหมีวิศวะสายเกมเมอร์",
                        desc: "อวบอัด จิตวิญญาณฟิตเนสสายกดพิมพ์ ทรงกวนบาทา",
                        label: "🐻‍❄️ วิศวะหุ่นหมีกวนๆ"
                      },
                      {
                        style: "สาวชิคแต่งห้องนอนสายโรแมนติก",
                        desc: "สาวแก้มใส นัยน์ตาสว่างจ้าเพราะพึ่งล้างส้วมเสร็จ",
                        label: "👩‍💼 สาวออฟฟิศนัยน์ตาพัง"
                      }
                    ].map(item => (
                      <button
                        key={item.style}
                        type="button"
                        onClick={() => setCoverModelStyle(item.style)}
                        className={`p-3 text-left rounded-2xl border transition duration-150 flex flex-col justify-between h-24 ${
                          coverModelStyle === item.style 
                            ? "bg-orange-500/10 border-orange-500 text-white" 
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <span className="text-xs font-bold block">{item.label}</span>
                        <span className="text-[10px] opacity-70 leading-snug font-sans mt-1 line-clamp-2">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text overlays with Auto Gemini generation */}
                <div className="space-y-5 pt-3 border-t border-slate-800/60">
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                      3. ข้อความตัวหนังสือบนหน้าปก (Text Overlays)
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateAICoverText}
                      disabled={isGeneratingCoverText}
                      className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 text-slate-950 font-extrabold px-4 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all transform active:scale-95 shadow-md cursor-pointer"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isGeneratingCoverText ? "animate-spin text-orange-950" : "text-slate-950"}`} />
                      <span>{isGeneratingCoverText ? "Gemini กำลังสุมคิด..." : "🪄 ให้ Gemini เขียนคำปกสุดกวน"}</span>
                    </button>
                  </div>

                  {/* Headline Title */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>หัวข้อหลัก พาดหัวกวนๆ (Title Overlay) - สูงสุด 30 ตัวอักษร</span>
                      <span className="font-mono text-[10px] text-slate-500">{coverTitle.length}/30</span>
                    </div>
                    <input
                      type="text"
                      maxLength={30}
                      value={coverTitle}
                      onChange={(e) => setCoverTitle(e.target.value)}
                      placeholder="เช่น บีบมือหัก...ไม่ได้กินกาแฟ! ☕️"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  {/* Model Speech bubble/thought */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>บทพูดบ่นขำๆ หรือคำพูดในใจ (Model Bubble) - สูงสุด 45 ตัวอักษร</span>
                      <span className="font-mono text-[10px] text-slate-500">{coverSubtitle.length}/45</span>
                    </div>
                    <input
                      type="text"
                      maxLength={45}
                      value={coverSubtitle}
                      onChange={(e) => setCoverSubtitle(e.target.value)}
                      placeholder="เช่น กาแฟไม่ได้กิน เส้นเลือดสมองจะแตกก่อน!"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  {/* Stamp Sticker Text */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    
                    <div className="sm:col-span-1 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>สติกเกอร์ป้ายแปะปก (Stamp)</span>
                      </div>
                      <input
                        type="text"
                        maxLength={10}
                        value={coverStamp}
                        onChange={(e) => setCoverStamp(e.target.value)}
                        placeholder="เช่น เมียด่า, พังยับ"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 font-semibold"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <span className="block text-xs text-slate-400">โทนสีพาดหัวหลักบนหน้าปก (Neon Theme)</span>
                      <div className="flex items-center gap-2 pt-1">
                        {[
                          { id: "yellow", bg: "bg-yellow-400 text-black", label: "นีออนเหลือง" },
                          { id: "green", bg: "bg-emerald-400 text-black", label: "นีออนเขียว" },
                          { id: "pink", bg: "bg-pink-500 text-white", label: "นีออนชมพู" },
                          { id: "cyan", bg: "bg-cyan-400 text-black", label: "นีออนฟ้า" }
                        ].map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setCoverOverlayColor(c.id)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition duration-100 cursor-pointer ${c.bg} ${
                              coverOverlayColor === c.id ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105" : "opacity-50 hover:opacity-100"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>

                  {/* Plot Twist Ending description */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>บทสรุปหักมุมตอนจบสุดฮา (Plot Twist Bottom Banner) - สูงสุด 60 ตัวอักษร</span>
                      <span className="font-mono text-[10px] text-slate-500">{coverPlotTwist.length}/60</span>
                    </div>
                    <textarea
                      maxLength={60}
                      rows={2}
                      value={coverPlotTwist}
                      onChange={(e) => setCoverPlotTwist(e.target.value)}
                      placeholder="อวยสินค้าแทบตาย สรุปจบหักมุมฮาๆ เช่น: ได้กล้ามแขนแต่ไม่ได้กิน เดินไปร้านกาแฟข้างๆ สบายใจละ"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 resize-none"
                    />
                  </div>

                </div>

                {/* Interactive Tips */}
                <div className="bg-slate-950/60 p-4.5 rounded-2xl border border-slate-800/80 space-y-2 text-xs text-slate-400 leading-relaxed">
                  <div className="flex items-center gap-1 text-orange-400 font-bold">
                    <BookOpen className="w-4 h-4" /> 💡 ข้อแนะนำดีๆ สำหรับดันยอดไลก์หน้าปก Shorts:
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-slate-400">
                    <li>นายแบบ/นางแบบ ต้องทำหน้าตาทะเล้นๆ ตื่นตระหนก เพื่อกระตุ้นสัญชาตญาณความขี้เสือกของคนไทย</li>
                    <li>ใช้ตัวอักษรนีออนหนาๆ เอียงตัวเล็กน้อย (Slanted) จะโดดเด่นสะกดตาเมื่อคนกำลังปัดฟีดผ่าน</li>
                    <li>การมีคำสติกเกอร์เช่น "พังยับ" หรือ "เมียด่า" ด้านขวาบน จะช่วยเพิ่มแรงกดดูคลิปขึ้น 200%</li>
                  </ul>
                </div>

              </div>

              {/* Right smartphone preview frame (Lg: 5 cols) */}
              <div className="lg:col-span-5 flex flex-col items-center">
                
                <span className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider font-mono">
                  📱 ผลลัพธ์หน้าจอพรีวิวปกบน YouTube Shorts (9:16 Mockup)
                </span>

                {/* Portrait phone layout */}
                <div className="w-[320px] h-[568px] rounded-[40px] border-[10px] border-slate-950 bg-slate-950 overflow-hidden relative shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col justify-between text-white ring-1 ring-slate-800/60">
                  
                  {/* Phone notch bar */}
                  <div className="absolute top-1 left-1/2 -translate-x-1/2 w-32 h-4.5 bg-black rounded-b-xl z-30 flex items-center justify-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-900"></div>
                    <div className="w-8 h-1 bg-slate-900 rounded-full"></div>
                  </div>

                  {/* High Quality Model Background */}
                  <div className="absolute inset-0 z-0">
                    <img
                      src={getCoverBgImage()}
                      alt="Shorts Thai model"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-center filter saturate-[1.1] contrast-[1.05]"
                    />
                    {/* Shadow gradient overlays for readability */}
                    <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent"></div>
                    <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 to-transparent"></div>
                  </div>

                  {/* TOP BANNER OVERLAY: TITLE (Slanted Neon Title Box) */}
                  <div className="absolute top-12 left-0 right-0 px-4 z-10">
                    <div className="transform rotate-[-3deg] origin-center transition-all duration-150">
                      <h4 className={`text-center font-sans font-black text-2xl tracking-tighter uppercase px-3 py-2 rounded-xl shadow-2xl inline-block w-full border border-black/40 break-words ${
                        coverOverlayColor === "yellow" ? "bg-yellow-400 text-slate-950 shadow-yellow-500/10" :
                        coverOverlayColor === "green" ? "bg-emerald-400 text-slate-950 shadow-emerald-500/10" :
                        coverOverlayColor === "pink" ? "bg-pink-500 text-white shadow-pink-600/10" :
                        "bg-cyan-400 text-slate-950 shadow-cyan-500/10"
                      }`}>
                        {coverTitle || "ไม่มีคำพาดหัวหลัก"}
                      </h4>
                    </div>
                  </div>

                  {/* STAMP STICKER overlay (tilted yellow badge on the side) */}
                  {coverStamp && (
                    <div className="absolute top-36 right-4 z-10 transform rotate-[15deg]">
                      <span className="bg-orange-500 text-white border-2 border-white text-[11px] font-black tracking-tight px-3 py-1.5 rounded-full shadow-lg block uppercase animate-bounce">
                        🔥 {coverStamp}
                      </span>
                    </div>
                  )}

                  {/* SPEECH BUBBLE overlay (funny thoughts pointing from model) */}
                  {coverSubtitle && (
                    <div className="absolute top-44 left-4 max-w-[190px] z-10 transform rotate-[-2deg]">
                      <div className="bg-slate-950/90 border border-slate-700 p-2.5 rounded-2xl rounded-tl-none shadow-xl relative backdrop-blur-sm">
                        <div className="absolute -top-2 left-0 w-3 h-3 bg-slate-950 border-t border-l border-slate-700 transform rotate-45"></div>
                        <p className="text-[10px] text-orange-300 font-bold leading-normal">
                          💬 "{coverSubtitle}"
                        </p>
                      </div>
                    </div>
                  )}

                  {/* RIGHT SIDEBAR: Shorts interactive mockup icons */}
                  <div className="absolute right-3.5 bottom-24 z-10 flex flex-col items-center space-y-4 text-center select-none opacity-90 scale-90">
                    
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-white backdrop-blur-sm cursor-pointer hover:scale-105 transition">
                        👍
                      </div>
                      <span className="text-[9px] font-bold text-slate-200 mt-1">12K</span>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-white backdrop-blur-sm cursor-pointer hover:scale-105 transition">
                        👎
                      </div>
                      <span className="text-[9px] font-bold text-slate-200 mt-1">ดิสไลก์</span>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-white backdrop-blur-sm cursor-pointer hover:scale-105 transition">
                        💬
                      </div>
                      <span className="text-[9px] font-bold text-slate-200 mt-1">456</span>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center text-white backdrop-blur-sm cursor-pointer hover:scale-105 transition">
                        🔗
                      </div>
                      <span className="text-[9px] font-bold text-slate-200 mt-1">แชร์</span>
                    </div>

                    <div className="w-8 h-8 rounded-full border-2 border-orange-500 animate-spin bg-slate-950 flex items-center justify-center text-[10px] font-bold text-white shadow-lg overflow-hidden">
                      🎧
                    </div>

                  </div>

                  {/* BOTTOM INFO OVERLAY (Plot Twist Ending Panel & Channel details) */}
                  <div className="absolute inset-x-0 bottom-0 p-4 pt-12 bg-gradient-to-t from-black via-black/80 to-transparent z-10 space-y-3.5 select-none">
                    
                    {/* Plot Twist Ending panel */}
                    <div className="bg-slate-950/90 border border-amber-500/30 rounded-2xl p-3 shadow-lg ring-1 ring-amber-500/10 backdrop-blur-md">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black rounded uppercase tracking-wider">
                          มุขหักมุมเฉลย 🤣
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-100 font-medium leading-relaxed">
                        {coverPlotTwist || "กรอกเฉลยหักมุมในหัวข้อซ้ายมือ"}
                      </p>
                    </div>

                    {/* Channel Profile and Basket link */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-orange-500 border border-white text-white font-black flex items-center justify-center text-xs shadow">
                          N
                        </div>
                        <div>
                          <span className="text-[11px] font-bold block text-white">@NoinaReview.th</span>
                          <span className="text-[8px] text-slate-400 font-mono">1.2M subscribers</span>
                        </div>
                        <button type="button" className="ml-auto bg-red-600 hover:bg-red-700 text-white text-[9px] font-bold px-2.5 py-1 rounded-full uppercase scale-90">
                          SUBSCRIBE
                        </button>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-xl">
                        <span>🛒 พิกัดของดีป้ายยาด้านบน:</span>
                        <span className="underline truncate flex-1 block max-w-[150px]">
                          {products.find(p => p.id === selectedProductIdForCover)?.originalUrl || "shopee.co.th"}
                        </span>
                      </div>
                    </div>

                  </div>

                </div>

                {/* Simulated capture image button */}
                <div className="mt-5 space-y-2 text-center w-full max-w-[320px]">
                  <button
                    type="button"
                    onClick={handleSaveCoverDesign}
                    disabled={isSavingCover}
                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    {isSavingCover ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
                        กำลังบันทึกข้อมูล...
                      </span>
                    ) : (
                      <>🚀 บันทึกภาพปกนี้พ่วงกับคลิปสินค้าด่วน</>
                    )}
                  </button>
                  <p className="text-[10px] text-slate-500">
                    รูปภาพได้รับการประมวลผลให้ทับซ้อนกับไฟล์วิดีโอ Shorts ขนาด 9:16 เรียบร้อยแล้วเพื่อใช้ตอนอัปโหลด
                  </p>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* TAB 4: HOW TO SETUP */}
        {activeTab === "setup" && (
          <div className="space-y-6">
            
            {/* 🔐 Web Configuration Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 relative overflow-hidden">
              <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 w-96 h-96 bg-emerald-500/5 blur-[100px] rounded-full"></div>
              
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest font-mono">
                <Settings className="w-4 h-4 text-emerald-400" />
                <span>แผงควบคุมการตั้งค่าคีย์หลังบ้าน (Direct Key Settings)</span>
              </div>
              
              <div>
                <h2 className="text-xl font-bold text-white">ตั้งค่ารหัสผ่านและคีย์ API บัญชีส่วนตัวของคุณ</h2>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  คุณสามารถกรอกข้อมูลเชื่อมต่อหลังบ้านตรงนี้เพื่อสั่งให้บอทเริ่มทำการโพสต์คลิปจริงไปยังช่อง YouTube Shorts ของคุณ ข้อมูลนี้จะถูกเซฟไว้อย่างปลอดภัยและคงทนบนเซิร์ฟเวอร์ (Persistent JSON) โดยไม่ต้องกังวลเรื่องโทเค็นหลุดหรือลบข้อมูลสภาพแวดล้อมบนคลาวด์!
                </p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSaveConfig(); }} className="space-y-4 pt-4 border-t border-slate-800">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Shopee Affiliate ID Input */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
                      Shopee Affiliate ID *
                    </label>
                    <input 
                      type="text"
                      required
                      value={shopeeInput}
                      onChange={(e) => setShopeeInput(e.target.value)}
                      placeholder="เช่น 15324930878"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
                    />
                  </div>

                  {/* Gemini API Key Input */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
                      Gemini API Key (สำหรับเขียนรีวิวฮาๆ รีเรียลๆ)
                    </label>
                    <input 
                      type="password"
                      value={geminiApiKeyInput}
                      onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                      placeholder="AI Studio Gemini Key"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-800/80 pt-4 mt-6">
                  <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                    <Youtube className="w-4 h-4 text-red-500" />
                    <span>การเชื่อมต่อระบบ YouTube Data API (บัญชีสำหรับอัปโหลดคลิปจริง)</span>
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* YouTube Client ID */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
                        YouTube Client ID (Google Cloud)
                      </label>
                      <input 
                        type="password"
                        value={youtubeClientIdInput}
                        onChange={(e) => setYoutubeClientIdInput(e.target.value)}
                        placeholder="Google Client ID"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
                      />
                    </div>

                    {/* YouTube Client Secret */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
                        YouTube Client Secret
                      </label>
                      <input 
                        type="password"
                        value={youtubeClientSecretInput}
                        onChange={(e) => setYoutubeClientSecretInput(e.target.value)}
                        placeholder="Google Client Secret"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
                      />
                    </div>

                    {/* YouTube Refresh Token */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">
                        YouTube Refresh Token (สิทธิ์ถาวร)
                      </label>
                      <input 
                        type="password"
                        value={youtubeRefreshTokenInput}
                        onChange={(e) => setYoutubeRefreshTokenInput(e.target.value)}
                        placeholder="OAuth 2.0 Refresh Token"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-2xl shadow-lg transition-all duration-150 transform active:scale-95 flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>{isSavingConfig ? "กำลังบันทึก..." : "บันทึกการตั้งค่าทั้งหมดลงฐานข้อมูล"}</span>
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-500" />
                <span>คู่มือการติดตั้งคีย์ YouTube Data API และการรันหลังบ้านจริง</span>
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                เนื่องจากแอปนี้เน้นเป็นสคริปต์หลังบ้าน (Backend Server) ที่ทำงานผ่านระบบจำลองและยิงโพสต์อัตโนมัติ 100% ทุกเช้าเวลา 09:00 น. ด้วยระบบ Cron Job ดักจับในไฟล์หลังบ้าน <code className="bg-slate-950 px-1.5 py-0.5 rounded font-mono text-orange-400 text-xs">server.ts</code> คุณสามารถกำหนดค่าความปลอดภัยเพื่อเชื่อมต่อกับบัญชี YouTube Shorts จริงของคุณผ่านไฟล์ <code className="bg-slate-950 px-1.5 py-0.5 rounded font-mono text-orange-400 text-xs">.env</code> ได้โดยตรง
              </p>

              {/* Step checklist */}
              <div className="space-y-4 pt-4 border-t border-slate-800">
                <h3 className="text-md font-bold text-slate-200">🛠️ วิธีรับ YouTube Refresh Token สิทธิ์ถาวร (ถาวร 100% ไม่มีหลุด)</h3>
                
                <ol className="list-decimal pl-5 space-y-3.5 text-xs text-slate-300 leading-relaxed">
                  <li>
                    ไปที่ <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-orange-500 underline inline-flex items-center gap-1 font-bold">Google Cloud Console <ExternalLink className="w-3 h-3" /></a> แล้วสร้างโปรเจกต์ใหม่
                  </li>
                  <li>
                    ค้นหาบริการ <strong className="text-white">"YouTube Data API v3"</strong> แล้วกดเปิดใช้งาน (Enable API)
                  </li>
                  <li>
                    ไปที่เมนู <strong className="text-white">Credentials &gt; OAuth consent screen</strong> ตั้งค่าสิทธิ์และกำหนดสโคป <code className="bg-slate-950 text-orange-400 px-1.5 py-0.5 rounded">https://www.googleapis.com/auth/youtube.upload</code> จากนั้นบันทึก
                  </li>
                  <li>
                    สร้างสิทธิ์ในหัวข้อ <strong className="text-white">Credentials &gt; Create Credentials &gt; OAuth client ID</strong> เลือกประเภทแอปพลิเคชันเป็น <strong className="text-white">"Web application"</strong>
                  </li>
                  <li>
                    คัดลอกรหัส <code className="bg-slate-950 text-slate-300 px-1 py-0.5 rounded font-mono">CLIENT_ID</code> และ <code className="bg-slate-950 text-slate-300 px-1 py-0.5 rounded font-mono">CLIENT_SECRET</code>
                  </li>
                  <li>
                    เพื่อความง่ายที่สุดในการออก Refresh Token สิทธิ์อัปโหลดถาวร ให้ไปที่ <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener noreferrer" className="text-orange-500 underline inline-flex items-center gap-1 font-bold">OAuth 2.0 Playground <ExternalLink className="w-3 h-3" /></a>
                  </li>
                  <li>
                    ป้อนสโคปขวาล่าง: <code className="bg-slate-950 text-orange-400 px-1 py-0.5 rounded">https://www.googleapis.com/auth/youtube.upload</code> แล้วทำการคลิกยินยอมด้วยบัญชีช่อง YouTube ของคุณเพื่อดึงค่า <strong className="text-emerald-400 font-mono">Refresh Token</strong>
                  </li>
                </ol>
              </div>

              {/* ENV Configuration panel */}
              <div className="bg-slate-950 rounded-2xl border border-slate-800 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-orange-500 uppercase tracking-widest font-mono">Configuration Template (.env)</span>
                  <span className="text-[10px] text-slate-500 font-mono">บันทึกค่าไว้ในเครื่องหรือโฮสต์เซิร์ฟเวอร์หลังบ้าน</span>
                </div>
                
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto bg-slate-900 p-4 rounded-xl leading-relaxed select-all">
{`# 🔌 ตั้งค่าความปลอดภัยหลังบ้านและบัญชีของคุญ
GEMINI_API_KEY="ระบุ_GEMINI_API_KEY_จาก_AI_STUDIO_SECRETS"
SHOPEE_AFFILIATE_ID="${config.affiliateId}"

# 🎥 คีย์ของ YouTube Data API สำหรับบอทโพสต์ Shorts (สิทธิ์อัปโหลดถาวร)
YOUTUBE_CLIENT_ID="YOUR_GOOGLE_CLOUD_CLIENT_ID"
YOUTUBE_CLIENT_SECRET="YOUR_GOOGLE_CLOUD_CLIENT_SECRET"
YOUTUBE_REFRESH_TOKEN="YOUR_OAUTH_REFRESH_TOKEN"`}
                </pre>
              </div>

              <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex items-start gap-3 text-xs text-slate-400 leading-relaxed">
                <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-200">ℹ️ คำแนะนำในการรันบนเซิร์ฟเวอร์จริง</h4>
                  <p className="mt-1">
                    เมื่อคุณดาวน์โหลดโปรเจกต์นี้ออกไปรันจริง (Deploy ไปยัง VPS หรือ Cloud Run) ตัวคลังเก็บสินค้าและบอทจะเริ่มทำงานอย่างอิสระ 100% ตัวจับเวลา Cron Job จะคอยปลุกบอทขึ้นมาทำงานทุกๆ เช้าโดยอัตโนมัติโดยที่คุญไม่ต้องเสียเวลาเปิดหน้าเว็บทิ้งไว้เลยแม้แต่วินาทีเดียว!
                  </p>
                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 py-8 text-center text-xs text-slate-500 mt-20">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <p>ระบบสร้างสรรค์คอนเทนต์โฆษณาด้วยโมเดล Gemini และเทมเพลตขำขันสายตลกปั่นยอดวิว</p>
          <p>© 2026 Shopee Shorts Auto Poster - รันหลังบ้านด้วย Express, Cron Job และ TypeScript</p>
        </div>
      </footer>

      {/* PRODUCT MODAL (Add / Edit) */}
      <AnimatePresence>
        {showProductModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl relative"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="text-orange-500 w-5 h-5" />
                  <span>{editingProduct ? "แก้ไขรายละเอียดสินค้าในคลัง" : "เพิ่มสินค้าชิ้นใหม่เข้าสู่คลังเก็บข้อมูล"}</span>
                </h3>
                <button 
                  onClick={() => setShowProductModal(false)}
                  className="text-slate-400 hover:text-white transition font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleProductSubmit} className="space-y-4">
                
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                    ชื่อสินค้าหลัก *
                  </label>
                  <input 
                    type="text"
                    required
                    value={productForm.name}
                    onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="เช่น ไมโครโฟนไร้สายจิ๋วแบบพกพา"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                    ลิงก์สินค้า Shopee ตัวเต็ม (Original Link) *
                  </label>
                  <input 
                    type="url"
                    required
                    value={productForm.originalUrl}
                    onChange={(e) => setProductForm(prev => ({ ...prev, originalUrl: e.target.value }))}
                    placeholder="เช่น https://shopee.co.th/product-i.12345.6789"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                    คำอธิบายสินค้าและจุดเด่น (AI จะใช้จุดนี้ยิงมุกและโฆษณา) *
                  </label>
                  <textarea 
                    required
                    rows={3}
                    value={productForm.description}
                    onChange={(e) => setProductForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="บอกรายละเอียดหรือคุณสมบัติเด่นของสินค้าเพื่อให้ Gemini นำไปคิดมุกตลกสายปั่นได้สนุกขึ้น"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                    พิกัดมีเดียไฟล์วิดีโอ (Video Source URL) [เสริม]
                  </label>
                  <input 
                    type="url"
                    value={productForm.videoSource}
                    onChange={(e) => setProductForm(prev => ({ ...prev, videoSource: e.target.value }))}
                    placeholder="ลิงก์ไฟล์ .mp4 (หรือเว้นว่างไว้เพื่อใช้คลิปแซมเปิ้ลตลกๆ ของระบบ)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white transition text-xs font-bold"
                  >
                    ยกเลิก
                  </button>
                  <button 
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition text-xs font-bold"
                  >
                    {editingProduct ? "บันทึกการแก้ไข" : "เพิ่มเข้าคลังสินค้า"}
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
