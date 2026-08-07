const CATEGORY_RULES = [
  {
    category: "Groceries",
    words: ["grocery", "groceries", "vegetable", "vegetables", "milk", "supermarket"]
  },
  {
    category: "Food",
    words: [
      "breakfast", "lunch", "dinner", "food", "snack", "snacks",
      "tea", "coffee", "restaurant", "swiggy", "zomato", "hotel"
    ]
  },
  {
    category: "Transport",
    words: [
      "petrol", "diesel", "fuel", "bus", "train", "taxi", "uber",
      "ola", "auto", "parking", "toll", "travel"
    ]
  },
  {
    category: "Bills",
    words: [
      "electricity", "current bill", "water bill", "internet", "wifi",
      "mobile bill", "recharge", "rent", "emi", "gas bill"
    ]
  },
  {
    category: "Shopping",
    words: ["shopping", "dress", "shirt", "shoe", "shoes", "amazon", "flipkart"]
  },
  {
    category: "Health",
    words: ["medicine", "medical", "doctor", "hospital", "pharmacy", "health"]
  },
  {
    category: "Education",
    words: ["course", "book", "books", "school", "college", "training", "exam"]
  },
  {
    category: "Entertainment",
    words: ["movie", "cinema", "netflix", "prime", "game", "games"]
  }
];

const PAYMENT_RULES = [
  { value: "UPI", words: ["upi", "gpay", "google pay", "phonepe", "paytm"] },
  { value: "Credit Card", words: ["credit card", "creditcard"] },
  { value: "Debit Card", words: ["debit card", "debitcard"] },
  { value: "Card", words: ["card"] },
  { value: "Cash", words: ["cash"] },
  { value: "Bank Transfer", words: ["bank transfer", "neft", "imps", "rtgs"] }
];

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(text) {
  const now = new Date();
  const lower = text.toLowerCase();

  if (lower.includes("yesterday")) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  const match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return now;
}

function detectAmount(text) {
  const normalized = text.replace(/,/g, "");
  const matches = normalized.match(/\b\d+(?:\.\d{1,2})?\b/g);
  if (!matches) return null;

  for (const candidate of matches) {
    const amount = Number(candidate);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return null;
}

function detectType(text) {
  const lower = text.toLowerCase();
  const incomeWords = [
    "salary", "income", "received", "credited", "bonus", "freelance payment"
  ];
  return incomeWords.some((word) => lower.includes(word))
    ? "income"
    : "expense";
}

function detectCategory(text, type) {
  if (type === "income") return "Income";

  const lower = text.toLowerCase();
  const matched = CATEGORY_RULES.find((rule) =>
    rule.words.some((word) => lower.includes(word))
  );
  return matched?.category || "Other";
}

function detectPaymentMethod(text) {
  const lower = text.toLowerCase();
  const matched = PAYMENT_RULES.find((rule) =>
    rule.words.some((word) => lower.includes(word))
  );
  return matched?.value || "Not specified";
}

export function parseExpense(text) {
  const rawText = String(text || "").trim();
  const amount = detectAmount(rawText);

  if (!rawText) {
    return { valid: false, error: "Enter an expense message." };
  }

  if (!amount) {
    return {
      valid: false,
      error: "I could not find an amount. Example: Lunch 150"
    };
  }

  const type = detectType(rawText);
  const date = parseDate(rawText);

  return {
    valid: true,
    amount,
    type,
    category: detectCategory(rawText, type),
    paymentMethod: detectPaymentMethod(rawText),
    description: rawText,
    dateKey: localDateKey(date),
    occurredAt: date.toISOString()
  };
}
