let worker = null;
let workerPromise = null;

async function getWorker() {
  if (worker) return worker;
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, {
      logger: (m) => {
        if (typeof m.progress !== "number") return;
        const p = m.progress;
        const statusMap = {
          "loading tesseract core": { base: 0, weight: 20, label: "Loading OCR engine..." },
          "initializing tesseract": { base: 20, weight: 5, label: "Initializing engine..." },
          "loading language traineddata": { base: 25, weight: 30, label: "Downloading language data..." },
          "initializing api": { base: 55, weight: 5, label: "Preparing scanner..." },
          "recognizing text": { base: 60, weight: 40, label: "Analyzing receipt..." },
        };
        const phase = statusMap[m.status];
        if (phase) {
          const percent = Math.round(phase.base + p * phase.weight);
          updateScanProgress(percent, `${phase.label} ${Math.round(p * 100)}%`);
        }
      },
    });
    return worker;
  })();
  try {
    return await workerPromise;
  } finally {
    workerPromise = null;
  }
}

function updateScanProgress(percent, message) {
  const bar = document.querySelector("#scanProgressFill");
  const label = document.querySelector("#scanProgressLabel");
  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = message || `Analyzing receipt... ${percent}%`;
}

function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.onload = () => {
      const maxWidth = 1500;
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const contrast = ((gray - 128) * 1.4) + 128;
        const val = Math.max(0, Math.min(255, contrast));
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob || file);
      }, "image/png");
    };
    img.src = url;
  });
}

function extractAmount(text) {
  const patterns = [
    /(?:total|grand\s*total|net\s*(?:amount|payable)|amount\s*(?:due|payable)|bill\s*amount)[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d*)/i,
    /(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)\s*(?:total|payable|due)/i,
    /(?:total|amount)[:\s]*(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0 && amount < 10000000) return amount;
    }
  }

  const amountPattern = /(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)/gi;
  const amounts = [];
  let m;
  while ((m = amountPattern.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ""));
    if (val > 0 && val < 10000000) amounts.push(val);
  }

  if (amounts.length) return Math.max(...amounts);
  return null;
}

function extractDate(text) {
  const patterns = [
    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/,
    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/,
    /(\d{1,2})\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*(\d{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (pattern === patterns[2]) {
        const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
        const monthMatch = text.match(/(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,.\s]*(\d{2,4})/i);
        if (monthMatch) {
          const day = monthMatch[1].padStart(2, "0");
          const month = months[monthMatch[2].toLowerCase().slice(0, 3)];
          let year = monthMatch[3];
          if (year.length === 2) year = "20" + year;
          return `${year}-${month}-${day}`;
        }
      } else {
        let [, first, second, y] = match;
        if (y.length === 2) y = "20" + y;
        first = first.padStart(2, "0");
        second = second.padStart(2, "0");
        // Indian format: DD/MM/YYYY
        let day = first, mo = second;
        if (Number(first) > 12 && Number(second) <= 12) {
          day = first; mo = second;
        } else if (Number(second) > 12 && Number(first) <= 12) {
          day = second; mo = first;
        }
        return `${y}-${mo}-${day}`;
      }
    }
  }
  return null;
}

function extractMerchant(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);

  const skipPatterns = /^(tax|gst|cgst|sgst|invoice|bill|receipt|date|time|total|amount|sub\s*total|qty|item|sr\.?|no\.?|sl\.?)/i;

  for (const line of lines.slice(0, 5)) {
    if (skipPatterns.test(line)) continue;
    if (/^\d+[\/\-.]/.test(line)) continue;
    if (/^[\d\s.,%₹]+$/.test(line)) continue;
    const cleaned = line.replace(/[^a-zA-Z\s&'.-]/g, "").trim();
    if (cleaned.length >= 3 && cleaned.length <= 50) {
      return cleaned;
    }
  }
  return null;
}

function suggestCategoryFromMerchant(merchant) {
  if (!merchant) return "Other";
  const lower = merchant.toLowerCase();
  const map = {
    Food: ["swiggy", "zomato", "restaurant", "cafe", "pizza", "burger", "kitchen", "dhaba", "bakery", "food", "eat"],
    Groceries: ["reliance", "dmart", "big bazaar", "bigbasket", "supermarket", "mart", "grocery", "fresh", "store"],
    Shopping: ["amazon", "flipkart", "myntra", "mall", "lifestyle", "shoppers", "fashion"],
    Transport: ["petrol", "fuel", "parking", "toll", "uber", "ola", "metro", "rapido"],
    Health: ["pharmacy", "medical", "apollo", "hospital", "clinic", "medplus", "1mg"],
    Bills: ["electricity", "airtel", "jio", "vodafone", "bill", "recharge"],
    Entertainment: ["pvr", "inox", "cinema", "movie", "theatre", "netflix"],
    Education: ["book", "stationery", "school", "college", "institute"],
  };

  for (const [category, keywords] of Object.entries(map)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "Other";
}

export async function scanReceipt(file) {
  const processed = await preprocessImage(file);
  const w = await getWorker();
  const { data } = await w.recognize(processed);
  const text = data.text;
  const confidence = data.confidence;

  const amount = extractAmount(text);
  const dateKey = extractDate(text);
  const merchant = extractMerchant(text);
  const category = suggestCategoryFromMerchant(merchant);

  return {
    valid: amount !== null,
    amount,
    description: merchant || "",
    dateKey: dateKey || new Date().toISOString().slice(0, 10),
    category,
    confidence: Math.round(confidence),
    rawText: text,
  };
}

export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
