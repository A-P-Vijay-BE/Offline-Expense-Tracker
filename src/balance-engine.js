export function normalizeType(type) {
  if (type === "expense") return "debit";
  if (type === "income") return "credit";
  return type;
}

export function calculateAccountBalance(account, transactions) {
  if (!account) return 0;
  let balance = Number(account.openingBalance || 0);

  for (const tx of transactions) {
    if (tx.deleted) continue;
    const type = normalizeType(tx.type);

    if (type === "debit" && tx.accountId === account.id) {
      balance -= Number(tx.amount || 0);
    } else if (type === "debit" && tx.fromAccountId === account.id) {
      balance -= Number(tx.amount || 0);
    } else if (type === "credit" && tx.accountId === account.id) {
      balance += Number(tx.amount || 0);
    } else if (type === "credit" && tx.toAccountId === account.id) {
      balance += Number(tx.amount || 0);
    } else if (type === "transfer") {
      if (tx.fromAccountId === account.id) {
        balance -= Number(tx.amount || 0);
      }
      if (tx.toAccountId === account.id) {
        balance += Number(tx.amount || 0);
      }
    } else if (type === "adjustment" && tx.accountId === account.id) {
      balance += Number(tx.balanceEffect || 0);
    }
  }

  return balance;
}

export function calculateAllAccountBalances(accounts, transactions) {
  const result = new Map();
  for (const account of accounts) {
    result.set(account.id, calculateAccountBalance(account, transactions));
  }
  return result;
}

export function calculateTotalAvailableBalance(accounts, transactions) {
  return accounts
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + calculateAccountBalance(a, transactions), 0);
}

export function calculateBalanceAfterEachTransaction(account, transactions) {
  if (!account) return new Map();

  const relevant = transactions
    .filter((tx) => {
      if (tx.deleted) return false;
      const type = normalizeType(tx.type);
      if (type === "debit" && (tx.accountId === account.id || tx.fromAccountId === account.id)) return true;
      if (type === "credit" && (tx.accountId === account.id || tx.toAccountId === account.id)) return true;
      if (type === "transfer" && (tx.fromAccountId === account.id || tx.toAccountId === account.id)) return true;
      if (type === "adjustment" && tx.accountId === account.id) return true;
      return false;
    })
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));

  let balance = Number(account.openingBalance || 0);
  const result = new Map();

  for (const tx of relevant) {
    const type = normalizeType(tx.type);
    if (type === "debit") {
      balance -= Number(tx.amount || 0);
    } else if (type === "credit") {
      balance += Number(tx.amount || 0);
    } else if (type === "transfer") {
      if (tx.fromAccountId === account.id) balance -= Number(tx.amount || 0);
      if (tx.toAccountId === account.id) balance += Number(tx.amount || 0);
    } else if (type === "adjustment") {
      balance += Number(tx.balanceEffect || 0);
    }
    result.set(tx.id, balance);
  }

  return result;
}
