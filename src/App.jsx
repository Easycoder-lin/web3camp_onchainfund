import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Send, Coins, AlertCircle, CheckCircle2 } from "lucide-react";
import { ethers } from "ethers";
import { ENZYME } from "./enzymeConfig";

// ====== Sepolia guard ======
const REQUIRED_CHAIN_ID = 11155111; // Sepolia
const REQUIRED_CHAIN_HEX = "0xaa36a7";
const REQUIRED_CHAIN_PARAMS = {
  chainId: REQUIRED_CHAIN_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// ====== Minimal ABIs ======

// Factory (your “deployer”)
const FUND_FACTORY_ABI = [
  "function createNewFund(address _fundOwner,string _fundName,string _fundSymbol,address _denominationAsset,uint256 _sharesActionTimelock,bytes _feeManagerConfigData,bytes _policyManagerConfigData) returns (address,address)",
  "function balanceOf(address) view returns (uint256)" // if you really need it
];

// Comptroller (buy/redeem/etc)
const COMPTROLLER_ABI = [
  "function calcGav() view returns (uint256)",
  "function calcGrossShareValue() view returns (uint256)",
  "function buyShares(uint256 _investmentAmount,uint256 _minSharesQuantity)",
  "function buySharesWithEth(uint256 _minSharesQuantity) payable",
  "function getDenominationAsset() view returns (address)",
  "function redeemSharesInKind(address,uint256,address[],address[])" // if exposed on comptroller in your fork
];

// Vault
const VAULT_PROXY_ABI = [
  "function getAccessor() view returns (address)"
];

// ERC20
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)"
];


// AddressListRegistry (create whitelist). Event signature is guessed/common; adjust if your fork differs.
const AddressListRegistryABI = [
  "function createList(address owner,uint8 updateType,address[] initialItems) returns (uint256 listId)",
  "event ListCreated(uint256 indexed listId, address indexed owner, uint8 updateType, address[] initialItems)"
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
  const [appTab, setAppTab] = useState("TRANSFER"); // TRANSFER | ENZYME
  const [mode, setMode] = useState("ERC20"); // "NATIVE" | "ERC20"
  const [status, setStatus] = useState(null); // { type: 'error'|'success'|'info', message: string, hash?: string }

  // Inputs (Transfer)
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  // Token state (Transfer)
  const [tokenAddr, setTokenAddr] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenBalance, setTokenBalance] = useState("0");

  // Native balance
  const [nativeBalance, setNativeBalance] = useState("0");

  // ===== Enzyme: Create Fund form state =====
  const [fundName, setFundName] = useState("My Sepolia Fund");
  const [fundSymbol, setFundSymbol] = useState("MSF");
  const [feeRecipient, setFeeRecipient] = useState(""); // defaults to your address after connect
  const [whitelist, setWhitelist] = useState(""); // comma-separated addresses
  const [listId, setListId] = useState("");        // if you have an existing listId, paste it here
  const [createdComptroller, setCreatedComptroller] = useState("");
  const [createdVault, setCreatedVault] = useState("");

  useEffect(() => {
    const ethereum = window.ethereum;
    setHasMM(!!ethereum);
    if (!ethereum) return;

    const p = new ethers.BrowserProvider(ethereum);
    setProvider(p);

    const handleAccounts = async (accs) => {
      const next = accs?.[0] ?? "";
      setAccount(next);
      setSigner(next ? await p.getSigner() : null);
      if (next && !feeRecipient) setFeeRecipient(next);
    };

    const handleChainChanged = async (hexId) => {
      const id = parseInt(hexId, 16);
      setChainId(id);
      try {
        const net = await p.getNetwork();
        setNetworkName(net?.name || "");
      } catch {}
      // Refresh balances when chain changes
      refreshBalances(p, account, tokenAddr);
      if (id !== REQUIRED_CHAIN_ID) {
        setStatus({ type: "error", message: "Wrong network. Please switch to Sepolia (11155111)." });
      } else {
        setStatus({ type: "success", message: "Switched to Sepolia." });
      }
    };

    ethereum.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => {});
    ethereum.request({ method: "eth_chainId" })
      .then((cidHex) => handleChainChanged(cidHex))
      .catch(() => {});

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

  async function switchToSepolia() {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: REQUIRED_CHAIN_HEX }],
      });
    } catch (e) {
      if (e?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [REQUIRED_CHAIN_PARAMS],
        });
      } else {
        throw e;
      }
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
      const cid = Number(net?.chainId);
      if (cid !== REQUIRED_CHAIN_ID) {
        await switchToSepolia();
        const net2 = await p.getNetwork();
        if (Number(net2.chainId) !== REQUIRED_CHAIN_ID) {
          throw new Error("Please switch MetaMask to Sepolia (chainId 11155111).");
        }
      }

      setChainId(REQUIRED_CHAIN_ID);
      setNetworkName("sepolia");
      if (!feeRecipient && next) setFeeRecipient(next);
      setStatus({ type: "success", message: "Wallet connected on Sepolia." });
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
          <h1 className="text-2xl font-semibold tracking-tight">MetaMask dApp (Transfer + Enzyme)</h1>
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

        {/* App tabs */}
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setAppTab("TRANSFER")}
            className={`px-4 py-2 rounded-xl border ${appTab === "TRANSFER" ? "bg-black text-white" : "bg-white"}`}
          >
            Transfer
          </button>
          <button
            onClick={() => setAppTab("ENZYME")}
            className={`px-4 py-2 rounded-xl border ${appTab === "ENZYME" ? "bg-black text-white" : "bg-white"}`}
          >
            Enzyme
          </button>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 grid gap-6"
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
          </div>

          {appTab === "TRANSFER" && (
            <>
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
            </>
          )}

          {appTab === "ENZYME" && (
            <div className="rounded-2xl border p-5 grid gap-4">
              <h2 className="text-lg font-semibold">Create Fund</h2>

              {/* Optional helper banner */}
              {chainId && chainId !== REQUIRED_CHAIN_ID && (
                <div className="p-3 rounded-xl bg-amber-50 text-amber-900 flex items-center justify-between">
                  <span>Wrong network (chainId {chainId}). Switch to Sepolia.</span>
                  <button onClick={switchToSepolia} className="rounded-lg bg-black text-white px-3 py-1 text-sm">Switch</button>
                </div>
              )}

              <label className="text-sm">Fund name</label>
              <input className="border rounded-xl px-3 py-2" value={fundName} onChange={e=>setFundName(e.target.value)} />

              <label className="text-sm">Fund symbol</label>
              <input className="border rounded-xl px-3 py-2" value={fundSymbol} onChange={e=>setFundSymbol(e.target.value)} />

              <label className="text-sm">Fee recipient (for entrance fee)</label>
              <input className="border rounded-xl px-3 py-2" placeholder="0x..." value={feeRecipient} onChange={e=>setFeeRecipient(e.target.value)} />

              <div className="grid gap-2">
                <label className="text-sm">Whitelist addresses (comma-separated)</label>
                <textarea className="border rounded-xl px-3 py-2" rows={3} placeholder="0xabc...,0xdef..." value={whitelist} onChange={e=>setWhitelist(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={handleCreateWhitelist} className="rounded-xl bg-black text-white px-3 py-2 text-sm">Create whitelist</button>
                  <input
                    className="border rounded-xl px-3 py-2 flex-1"
                    placeholder="Or paste existing listId (uint256)"
                    value={listId}
                    onChange={(e)=>setListId(e.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-500">You can either create a new whitelist or paste an existing <code>listId</code>.</p>
              </div>

              <button onClick={handleCreateFund} className="rounded-2xl bg-black text-white px-4 py-2">Create Fund</button>

              {createdComptroller && (
                <div className="text-sm">
                  <p>ComptrollerProxy: <span className="font-mono break-all">{createdComptroller}</span></p>
                  <p>VaultProxy: <span className="font-mono break-all">{createdVault}</span></p>
                </div>
              )}
            </div>
          )}

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

  // ===== Handlers (inside component scope so they see state) =====

  async function handleCreateWhitelist() {
    try {
      if (!signer) throw new Error("Connect wallet first");
      const arr = whitelist.split(",").map(s => s.trim()).filter(Boolean);
      if (arr.length === 0) throw new Error("Whitelist is empty");

      const registry = new ethers.Contract(ENZYME.ADDRESS_LIST_REGISTRY, AddressListRegistryABI, signer);
      // UpdateType.None (0) — adjust if your fork differs
      const tx = await registry.createList(account, 0, arr);
      setStatus({ type: "info", message: `Creating whitelist…`, hash: tx.hash });
      const receipt = await tx.wait();

      // Try to parse ListCreated event for listId
      let newId = "";
      try {
        const iface = new ethers.Interface(AddressListRegistryABI);
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === ENZYME.ADDRESS_LIST_REGISTRY.toLowerCase()) {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "ListCreated") {
              // listId is args[0] by our ABI guess; adjust if needed
              newId = parsed.args?.listId?.toString?.() || parsed.args?.[0]?.toString?.() || "";
              break;
            }
          }
        }
      } catch (e) {
        // If parsing fails (ABI mismatch), user can copy it from explorer
      }

      if (newId) {
        setListId(newId);
        setStatus({ type: "success", message: `Whitelist created. listId=${newId}`, hash: tx.hash });
      } else {
        setStatus({ type: "success", message: `Whitelist created. Couldn’t parse listId; check tx on explorer`, hash: tx.hash });
      }
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", message: shortErr(err) });
    }
  }

  async function handleCreateFund() {
    try {
        if (!signer) throw new Error("Connect wallet first");
        if (Number(chainId) !== REQUIRED_CHAIN_ID) throw new Error("Wrong network. Switch to Sepolia.");
        if (!isHexAddress(feeRecipient)) throw new Error("Invalid fee recipient");

        // Validate addresses you shared
        for (const [k, v] of Object.entries(ENZYME)) {
        if (!isHexAddress(v)) throw new Error(`ENZYME.${k} is not a valid address`);
        }

        // Validate listId if you plan to use policy
        const listIdNum = listId ? (() => { try { return BigInt(listId); } catch { return null } })() : null;
        // listId is only required if you actually pass the policy; we'll try both below

        const coder = ethers.AbiCoder.defaultAbiCoder();
        const factory = new ethers.Contract(ENZYME.FUND_DEPLOYER, FUND_FACTORY_ABI, signer);

        // Build configs (fee 1% to feeRecipient; policy uses your listId)
        const feeSettings = coder.encode(["uint256","address"], [100n, feeRecipient]); // 100 bps = 1%
        const fee_full   = coder.encode(["address[]","bytes[]"], [[ENZYME.ENTRANCE_RATE_DIRECT_FEE], [feeSettings]]);

        const policy_full = (listIdNum && listIdNum > 0n)
        ? coder.encode(["address[]","bytes[]"],
            [[ENZYME.ALLOWED_DEPOSIT_RECIPIENTS_POLICY],
            [coder.encode(["uint256[]","bytes[]"], [[listIdNum], []])]])
        : coder.encode(["address[]","bytes[]"], [[],[]]); // if no listId, start without policy

        const empty_cfg = coder.encode(["address[]","bytes[]"], [[],[]]);

        // helper to try a variant
        async function tryVariant(label, denom, feeData, polData) {
        // 1) dry-run: get predicted return values (comptrollerProxy_, vaultProxy_)
        const [predComp, predVault] = await factory.createNewFund.staticCall(
            account, fundName, fundSymbol, denom, 0n, feeData, polData
        );

        // 2) real tx
        const tx = await factory.createNewFund(
            account, fundName, fundSymbol, denom, 0n, feeData, polData
        );
        setStatus({ type: "info", message: `Deploying fund… (${label})`, hash: tx.hash });
        const receipt = await tx.wait();
        return { receipt, predComp, predVault };
        }

        // Try in this order to pinpoint cause:
        // A) WETH + fee/policy
        // B) WETH + no fee/policy
        // C) USDC + no fee/policy
        let result;
        try {
        result = await tryVariant("WETH + fee/policy", ENZYME.WETH, fee_full, policy_full);
        } catch (eA) {
        try {
            result = await tryVariant("WETH + NO fee/policy", ENZYME.WETH, empty_cfg, empty_cfg);
            setStatus({ type: "info", message: "Fee/policy likely not accepted by this release. Created without fee/policy." });
        } catch (eB) {
            try {
            result = await tryVariant("USDC + NO fee/policy", ENZYME.USDC, empty_cfg, empty_cfg);
            setStatus({ type: "info", message: "WETH likely not allowed as denomination. Created with USDC, no fee/policy." });
            } catch (eC) {
            throw new Error(
                shortErr(eA) || shortErr(eB) || shortErr(eC) || "Fund creation reverted during gas estimation."
            );
            }
        }
        }

        const { receipt, predComp, predVault } = result;

        // Prefer predicted addresses from staticCall; they are the function returns
        const comp = predComp;
        const vault = predVault;

        if (comp && vault) {
        setCreatedComptroller(comp);
        setCreatedVault(vault);
        setStatus({ type: "success", message: `Fund created. Comptroller: ${shortAddr(comp)} • Vault: ${shortAddr(vault)}` });
        } else {
        setStatus({ type: "success", message: "Fund created. Couldn’t read return values; check tx on explorer." });
        }
    } catch (err) {
        console.error(err);
        setStatus({ type: "error", message: shortErr(err) });
    }
  }
}

// ===== helpers =====
function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortErr(err) {
  const m = err?.reason || err?.data?.message || err?.message || String(err);
  return m.replace("execution reverted: ", "");
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
