import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Send, Coins, ArrowRightLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { ethers } from "ethers";

// Minimal ERC-20 ABI
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

function isHexAddress(addr) {
  try {
    return ethers.isAddress(addr);
  } catch {
    return false;
  }
}

export default function App() {
  const [hasMM, setHasMM] = useState(false);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [networkName, setNetworkName] = useState("");

  // UI state
  const [mode, setMode] = useState("ERC20"); // "NATIVE" | "ERC20"
  const [status, setStatus] = useState(null); // { type: 'error'|'success'|'info', message: string, hash?: string }

  // Inputs
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  // Token state
  const [tokenAddr, setTokenAddr] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenBalance, setTokenBalance] = useState("0");

  // Native balance
  const [nativeBalance, setNativeBalance] = useState("0");

  useEffect(() => {
    const ethereum = window.ethereum;
    setHasMM(!!ethereum);
    if (!ethereum) return;

    const p = new ethers.BrowserProvider(ethereum);
    setProvider(p);

    const handleAccounts = (accs) => {
      const next = accs?.[0] ?? "";
      setAccount(next);
      setSigner(next ? p.getSigner() : null);
    };

    const handleChainChanged = async (hexId) => {
      const id = Number(hexId);
      setChainId(id);
      try {
        const net = await p.getNetwork();
        setNetworkName(net?.name || "");
      } catch {}
      // Refresh balances when chain changes
      refreshBalances(p, account, tokenAddr);
    };

    ethereum.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => {});
    ethereum.request({ method: "eth_chainId" }).then(handleChainChanged).catch(() => {});

    ethereum.on("accountsChanged", handleAccounts);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener("accountsChanged", handleAccounts);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!provider || !account) return;
    refreshBalances(provider, account, tokenAddr);
  }, [provider, account, tokenAddr, mode]);

  async function refreshBalances(p, acc, tAddr) {
    try {
      if (acc) {
        const bal = await p.getBalance(acc);
        setNativeBalance(ethers.formatEther(bal));
      }
      if (mode === "ERC20" && isHexAddress(tAddr) && acc) {
        const erc = new ethers.Contract(tAddr, ERC20_ABI, p);
        const [sym, dec] = await Promise.all([erc.symbol(), erc.decimals()]);
        setTokenSymbol(sym);
        setTokenDecimals(Number(dec));
        const bal = await erc.balanceOf(acc);
        setTokenBalance(ethers.formatUnits(bal, Number(dec)));
      } else {
        setTokenBalance("0");
        setTokenSymbol("");
      }
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", message: shortErr(err) });
    }
  }

  async function connect() {
    try {
      if (!hasMM) throw new Error("MetaMask not detected");
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      const p = new ethers.BrowserProvider(window.ethereum);
      setProvider(p);
      const next = accs?.[0] ?? "";
      setAccount(next);
      setSigner(next ? await p.getSigner() : null);
      const net = await p.getNetwork();
      setChainId(Number(net?.chainId));
      setNetworkName(net?.name || "");
      setStatus({ type: "success", message: "Wallet connected." });
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", message: shortErr(err) });
    }
  }

  const canTransfer = useMemo(() => {
    const amtOk = Number(amount) > 0 && isFinite(Number(amount));
    const toOk = isHexAddress(recipient);
    if (mode === "NATIVE") return amtOk && toOk && !!signer;
    return amtOk && toOk && isHexAddress(tokenAddr) && !!signer;
  }, [mode, amount, recipient, tokenAddr, signer]);

  async function transfer() {
    if (!canTransfer) return;
    try {
      setStatus({ type: "info", message: "Preparing transaction..." });
      if (mode === "NATIVE") {
        const tx = await signer.sendTransaction({
          to: recipient,
          value: ethers.parseEther(amount)
        });
        setStatus({ type: "info", message: `Sent. Waiting for confirmation...`, hash: tx.hash });
        const rec = await tx.wait();
        setStatus({ type: "success", message: `Native transfer confirmed in block ${rec.blockNumber}.`, hash: tx.hash });
      } else {
        const erc = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
        const value = ethers.parseUnits(amount, tokenDecimals);
        const tx = await erc.transfer(recipient, value);
        setStatus({ type: "info", message: `Sent. Waiting for confirmation...`, hash: tx.hash });
        const rec = await tx.wait();
        setStatus({ type: "success", message: `${amount} ${tokenSymbol || "tokens"} transferred. Block ${rec.blockNumber}.`, hash: tx.hash });
      }
      // Refresh balances post tx
      if (provider && account) await refreshBalances(provider, account, tokenAddr);
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", message: shortErr(err) });
    }
  }

  async function addTokenToWallet() {
    if (!(window.ethereum && isHexAddress(tokenAddr))) return;
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddr,
            symbol: tokenSymbol || "TKN",
            decimals: tokenDecimals || 18
          }
        }
      });
    } catch (err) {
      setStatus({ type: "error", message: shortErr(err) });
    }
  }

  const chainLabel = useMemo(() => {
    if (!chainId) return "";
    return `${networkName || "Network"} (chainId ${chainId})`;
  }, [chainId, networkName]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900">
      <header className="max-w-3xl mx-auto px-4 pt-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Coins className="w-6 h-6" />
          <h1 className="text-2xl font-semibold tracking-tight">MetaMask Token Transfer</h1>
        </div>
        <button
          onClick={connect}
          className="inline-flex items-center gap-2 rounded-2xl bg-black text-white px-4 py-2 shadow hover:opacity-90"
        >
          <Wallet className="w-4 h-4" /> {account ? shortAddr(account) : "Connect"}
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-24">
        {!hasMM && (
          <div className="mt-6 p-4 rounded-xl bg-amber-50 text-amber-900 flex gap-3 items-start">
            <AlertCircle className="w-5 h-5 mt-0.5" />
            <div>
              <p className="font-medium">MetaMask not detected.</p>
              <p className="text-sm opacity-80">Install the extension and refresh this page.</p>
            </div>
          </div>
        )}

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 grid gap-6"
        >
          {/* Network & balances */}
          <div className="rounded-2xl border p-5 grid gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Network</p>
                <p className="font-medium">{chainLabel || "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Native balance</p>
                <p className="font-medium">{Number(nativeBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
              </div>
            </div>
            {mode === "ERC20" && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Token balance</p>
                  <p className="font-medium">{Number(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {tokenSymbol || ""}</p>
                </div>
                <button onClick={addTokenToWallet} className="text-sm underline">Add token to wallet</button>
              </div>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("NATIVE")}
              className={`px-4 py-2 rounded-xl border ${mode === "NATIVE" ? "bg-black text-white" : "bg-white"}`}
            >
              Native
            </button>
            <button
              onClick={() => setMode("ERC20")}
              className={`px-4 py-2 rounded-xl border ${mode === "ERC20" ? "bg-black text-white" : "bg-white"}`}
            >
              ERC-20
            </button>
          </div>

          {/* Token selector (ERC20) */}
          {mode === "ERC20" && (
            <div className="rounded-2xl border p-5 grid gap-2">
              <label className="text-sm text-gray-600">Token contract address</label>
              <input
                value={tokenAddr}
                onChange={(e) => setTokenAddr(e.target.value.trim())}
                placeholder="0x..."
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              />
              {tokenSymbol && (
                <p className="text-sm text-gray-500">Detected: <span className="font-medium">{tokenSymbol}</span> (decimals {tokenDecimals})</p>
              )}
            </div>
          )}

          {/* Recipient & amount */}
          <div className="rounded-2xl border p-5 grid gap-3">
            <div className="grid gap-2">
              <label className="text-sm text-gray-600">Recipient address</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                placeholder="0x..."
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              />
              {!recipient || isHexAddress(recipient) ? null : (
                <p className="text-sm text-amber-700">Invalid address</p>
              )}
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-gray-600">Amount {mode === "NATIVE" ? `(ETH)` : tokenSymbol ? `(${tokenSymbol})` : ""}</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              />
            </div>
            <button
              onClick={transfer}
              disabled={!canTransfer}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black text-white px-4 py-3 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {mode === "NATIVE" ? "Send Native" : `Send ${tokenSymbol || "Token"}`}
            </button>
          </div>

          {/* Status */}
          {status && (
            <div className={`rounded-2xl border p-4 flex items-start gap-3 ${
              status.type === "error" ? "border-red-300 bg-red-50 text-red-900" :
              status.type === "success" ? "border-green-300 bg-green-50 text-green-900" :
              "border-blue-300 bg-blue-50 text-blue-900"
            }`}>
              {status.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 mt-0.5" />
              )}
              <div>
                <p className="font-medium">{capitalize(status.type)}</p>
                <p className="text-sm opacity-90 break-all">{status.message}</p>
                {status.hash && (
                  <p className="text-sm mt-1 opacity-75 break-all">Tx hash: {status.hash}</p>
                )}
              </div>
            </div>
          )}
        </motion.section>
      </main>

      <footer className="text-center text-xs text-gray-500 pb-6">Built with React + ethers.js • Use at your own risk</footer>
    </div>
  );
}

function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortErr(err) {
  const m = err?.reason || err?.data?.message || err?.message || String(err);
  // Clean common noisy prefixes
  return m.replace("execution reverted: ", "");
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
