import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Send, Coins, AlertCircle, CheckCircle2 } from "lucide-react";
import { ethers } from "ethers";
import { ENZYME } from "./enzymeConfig";

const REQUIRED_CHAIN_ID = 11155111; // Sepolia
const REQUIRED_CHAIN_HEX = "0xaa36a7";
const REQUIRED_CHAIN_PARAMS = {
    chainId: REQUIRED_CHAIN_HEX,
    chainName: "Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// ===== ABIs =====
const FUND_FACTORY_ABI = [
    "function createNewFund(address _fundOwner,string _fundName,string _fundSymbol,address _denominationAsset,uint256 _sharesActionTimelock,bytes _feeManagerConfigData,bytes _policyManagerConfigData) returns (address,address)",
];

const COMPTROLLER_ABI = [
    "function getVaultProxy() view returns (address)",
    "function getDenominationAsset() view returns (address)",
    "function buyShares(uint256 _investmentAmount,uint256 _minSharesQuantity) returns (uint256)",
    "function calcGav() view returns (uint256)",
    "function calcGrossShareValue() view returns (uint256)",
    "function buySharesWithEth(uint256 _minSharesQuantity) payable",
    // 你的 fork 將 redeem 暴露在 Comptroller（你已成功用過）
    "function redeemSharesInKind(address _recipient,uint256 _sharesQty,address[] _additionalAssets,address[] _assetsToSkip) returns (address[],uint256[])",
    "function redeemSharesForSpecificAssets(address _recipient,uint256 _sharesQty,address[] _payoutAssets,uint256[] _payoutPercents) returns (uint256[])",
    "function callOnExtension(address _extension,uint256 _actionId,bytes _callArgs)"
];

const VAULT_PROXY_ABI = [
    "function getAccessor() view returns (address)",
    "function redeemSharesInKind(address _recipient,uint256 _sharesQty,address[] _additionalAssets,address[] _assetsToSkip) returns (address[],uint256[])",
    "function redeemSharesForSpecificAssets(address _recipient,uint256 _sharesQty,address[] _payoutAssets,uint256[] _payoutPercents) returns (uint256[])",
    "function callOnExtension(address _extension,uint256 _actionId,bytes _callData)"
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function transfer(address,uint256) returns (bool)",
];

// V2 adapter：takeOrder(bytes)；加上 parseAssetsForAction 作 preflight
const UNISWAP_ADAPTER_ABI = [
    "function takeOrder(bytes _orderData)",
    "function parseAssetsForAction(bytes4 _selector, bytes _encodedCallArgs) view returns (uint8,uint256,address[],uint256[],address[],uint256[])"
];

const INTEGRATION_ACTION_CALL = 0;

const AddressListRegistryABI = [
    "function createList(address owner,uint8 updateType,address[] initialItems) returns (uint256 listId)",
    "event ListCreated(uint256 indexed listId, address indexed owner, uint8 updateType, address[] initialItems)",
];

const SHARES_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

function isHexAddress(addr) {
    try { return ethers.isAddress(addr); } catch { return false; }
}

export default function App() {
    const [hasMM, setHasMM] = useState(false);
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState("");
    const [chainId, setChainId] = useState(0);
    const [networkName, setNetworkName] = useState("");

    // UI state
    const [appTab, setAppTab] = useState("TRANSFER"); // TRANSFER | INVEST | SWAP | ENZYME
    const [mode, setMode] = useState("ERC20"); // "NATIVE" | "ERC20"
    const [status, setStatus] = useState(null); // { type, message, hash? }

    // Transfer
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [tokenAddr, setTokenAddr] = useState("");
    const [tokenSymbol, setTokenSymbol] = useState("");
    const [tokenDecimals, setTokenDecimals] = useState(18);
    const [tokenBalance, setTokenBalance] = useState("0");

    // Native balance
    const [nativeBalance, setNativeBalance] = useState("0");

    // Enzyme (create)
    const [fundName, setFundName] = useState("My Sepolia Fund");
    const [fundSymbol, setFundSymbol] = useState("MSF");
    const [feeRecipient, setFeeRecipient] = useState("");
    const [whitelist, setWhitelist] = useState("");
    const [listId, setListId] = useState("");
    const [createdComptroller, setCreatedComptroller] = useState("");
    const [createdVault, setCreatedVault] = useState("");

    // Invest
    const [cpAddr, setCpAddr] = useState("");          // ComptrollerProxy
    const [investAmt, setInvestAmt] = useState("");
    const [minShares, setMinShares] = useState("");
    const [vaultAddr, setVaultAddr] = useState("");    // optional, you也可自動讀
    const [redeemShares, setRedeemShares] = useState("");
    const [redeemAssets, setRedeemAssets] = useState("");     // e.g. WETH,USDC 或地址
    const [redeemPercents, setRedeemPercents] = useState(""); // bps 或 70,30 或 0.7,0.3
    const [denomAddr, setDenomAddr] = useState("");
    const [denomSymbol, setDenomSymbol] = useState("");
    const [denomDecimals, setDenomDecimals] = useState(18);
    const [myShares, setMyShares] = useState(null);

    // Swap
    const [fundCpForSwap, setFundCpForSwap] = useState("");
    const [sellAmt, setSellAmt] = useState("");
    const [minBuyAmt, setMinBuyAmt] = useState("");
    const [swapPath, setSwapPath] = useState("");
    const [imAddr, setImAddr] = useState(ENZYME.INTEGRATION_MANAGER || "");
    const [uniAdapter, setUniAdapter] = useState(ENZYME.UNISWAP_ADAPTER || ""); // 你的 adapter（非 V2 也可）

    // ===== Effects =====
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
            const p2 = new ethers.BrowserProvider(window.ethereum);
            setProvider(p2);
            setSigner(account ? await p2.getSigner() : null);
            try {
                const net = await p2.getNetwork();
                setNetworkName(net?.name || "");
            } catch { }
            refreshBalances(p2, account, tokenAddr);
            setStatus(id !== REQUIRED_CHAIN_ID
                ? { type: "error", message: "Wrong network. Please switch to Sepolia (11155111)." }
                : { type: "success", message: "Switched to Sepolia." }
            );
        };

        ethereum.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => { });
        ethereum.request({ method: "eth_chainId" }).then((cidHex) => handleChainChanged(cidHex)).catch(() => { });
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

    // 安全注入 IM / Adapter 預設地址（避免在渲染期直接讀 ENZYME 造成白屏）
    useEffect(() => {
        try {
            if (ENZYME && ethers.isAddress(ENZYME.INTEGRATION_MANAGER)) {
                setImAddr(ENZYME.INTEGRATION_MANAGER);
            }
            if (ENZYME && ethers.isAddress(ENZYME.UNISWAP_ADAPTER)) {
                setUniAdapter(ENZYME.UNISWAP_ADAPTER);
            }
        } catch (_) {
            // 忽略；使用者可以手動輸入
        }
    }, []);


    // ===== Helpers (logic) =====
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
            await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: REQUIRED_CHAIN_HEX }] });
        } catch (e) {
            if (e?.code === 4902) {
                await window.ethereum.request({ method: "wallet_addEthereumChain", params: [REQUIRED_CHAIN_PARAMS] });
            } else { throw e; }
        }
    }

    async function connect() {
        try {
            if (!hasMM) throw new Error("MetaMask not detected");
            const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
            const next = accs?.[0] ?? "";

            let cidHex = await window.ethereum.request({ method: "eth_chainId" });
            if (parseInt(cidHex, 16) !== REQUIRED_CHAIN_ID) {
                await switchToSepolia();
                cidHex = await window.ethereum.request({ method: "eth_chainId" });
                if (parseInt(cidHex, 16) !== REQUIRED_CHAIN_ID) {
                    throw new Error("Please switch MetaMask to Sepolia (chainId 11155111).");
                }
            }

            const p = new ethers.BrowserProvider(window.ethereum);
            const s = next ? await p.getSigner() : null;
            setProvider(p);
            setSigner(s);
            setAccount(next);
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
                const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amount) });
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
                params: { type: "ERC20", options: { address: tokenAddr, symbol: tokenSymbol || "TKN", decimals: tokenDecimals || 18 } },
            });
        } catch (err) {
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    // ===== Invest handlers =====
    async function handleApproveAndBuyShares() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");

            const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, signer);
            // 優先用手動 denom，其次嘗試讀取
            const [vault, denom] = await Promise.all([cp.getVaultProxy(), resolveDenominationAddressOrThrow()]);
            const erc = new ethers.Contract(denom, ERC20_ABI, signer);
            const decimals = await erc.decimals();
            const amt = ethers.parseUnits(investAmt || "0", Number(decimals));

            // minShares：使用者填了就用；否則用 gsv 推估並留 1% buffer，且至少 1 wei
            let min;
            if (minShares && Number(minShares) > 0) {
                min = ethers.parseUnits(minShares, 18);
            } else {
                const gsv = await cp.calcGrossShareValue().catch(() => 0n);
                if (gsv > 0n) {
                    const ONE_E18 = 10n ** 18n;
                    const expected = (amt * ONE_E18) / gsv;
                    const withBuffer = (expected * 9900n) / 10000n; // 1% buffer
                    min = withBuffer > 0n ? withBuffer : 1n;
                } else {
                    min = 1n;
                }
            }

            await ensureAllowance(erc, account, vault, amt, "Vault");
            await ensureAllowance(erc, account, cpAddr, amt, "Comptroller");

            const tx2 = await cp.buyShares(amt, min);
            setStatus({ type: "info", message: `buyShares sent…`, hash: tx2.hash });
            const rc = await tx2.wait();
            setStatus({ type: "success", message: `Subscribed. Block ${rc.blockNumber}.`, hash: tx2.hash });
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    // 用 ETH 直接申購（只適用 denom=WETH）
    async function handleBuySharesWithEth() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");
            if (!investAmt || Number(investAmt) <= 0) throw new Error("Enter investment amount");

            try {
                const ABI = ["function getDenominationAsset() view returns (address)"];
                const cpView = new ethers.Contract(cpAddr, ABI, provider || signer);
                const denom = await cpView.getDenominationAsset();
                if (ENZYME?.WETH && ethers.isAddress(ENZYME.WETH) &&
                    denom?.toLowerCase?.() !== ENZYME.WETH.toLowerCase()) {
                    throw new Error("buySharesWithEth is only supported when denomination asset is WETH");
                }
            } catch { /* 沒 getter 就放行，由合約自行判斷 */ }

            const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, signer);
            const value = ethers.parseUnits(investAmt, 18);

            let min;
            try {
                const gsv = await cp.calcGrossShareValue();
                if (gsv > 0n) {
                    const ONE_E18 = 10n ** 18n;
                    const expected = (value * ONE_E18) / gsv;
                    const withBuffer = (expected * 9900n) / 10000n;
                    min = withBuffer > 0n ? withBuffer : 1n;
                } else {
                    min = 1n;
                }
            } catch { min = 1n; }

            const tx = await cp.buySharesWithEth(min, { value });
            setStatus({ type: "info", message: `buySharesWithEth sent…`, hash: tx.hash });
            const rc = await tx.wait();
            setStatus({ type: "success", message: `Subscribed with ETH. Block ${rc.blockNumber}.`, hash: tx.hash });
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    async function wrapEthQuick() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            const wethAddr = denomAddr || ENZYME?.WETH;
            if (!ethers.isAddress(wethAddr)) throw new Error("Set denomination token (WETH) first");
            const value = ethers.parseUnits(investAmt || "0", 18);
            if (value <= 0n) throw new Error("Enter investment amount");
            const weth = new ethers.Contract(wethAddr, ["function deposit() payable"], signer);
            const tx = await weth.deposit({ value });
            setStatus({ type: "info", message: `Wrapping ETH…`, hash: tx.hash });
            const rc = await tx.wait();
            setStatus({ type: "success", message: `Wrapped to WETH. Block ${rc.blockNumber}.`, hash: tx.hash });
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    async function handleRedeemInKind() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");

            const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, signer);
            const sharesQty = ethers.parseUnits(redeemShares || "0", 18);
            if (sharesQty <= 0n) throw new Error("Shares must be > 0");

            const tx = await cp.redeemSharesInKind(account, sharesQty, [], []);
            setStatus({ type: "info", message: `Redeeming in kind…`, hash: tx.hash });
            const rc = await tx.wait();
            setStatus({ type: "success", message: `Redeemed (in-kind). Block ${rc.blockNumber}.`, hash: tx.hash });
            await fetchMyShares?.();
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    async function handleRedeemSpecific() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");

            const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, signer);
            const sharesQty = ethers.parseUnits(redeemShares || "0", 18);
            if (sharesQty <= 0n) throw new Error("Shares must be > 0");

            const assets = parseAssetsFlexible(redeemAssets);
            const percents = parsePercentsToBps(redeemPercents);
            if (assets.length === 0) throw new Error("No assets provided");
            if (assets.length !== percents.length) throw new Error(`Assets (${assets.length}) and percentages (${percents.length}) mismatch`);

            const tx = await cp.redeemSharesForSpecificAssets(account, sharesQty, assets, percents);
            setStatus({ type: "info", message: `Redeeming for specific assets…`, hash: tx.hash });
            const rc = await tx.wait();
            setStatus({ type: "success", message: `Redeemed (specific). Block ${rc.blockNumber}.`, hash: tx.hash });
            await fetchMyShares?.();
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }
    // 檢查 Vault 是否持有 path[0] 且餘額足夠
    async function checkVaultHasSellToken(cpAddrUse, sellToken, needAmountBN, sellTokenDecimals) {
        const cp = new ethers.Contract(cpAddrUse, COMPTROLLER_ABI, provider || signer);
        const vault = await cp.getVaultProxy();

        const erc = new ethers.Contract(sellToken, ERC20_ABI, provider || signer);
        const [sym, bal] = await Promise.all([
            erc.symbol().catch(() => ""),
            erc.balanceOf(vault),
        ]);

        if (bal < needAmountBN) {
            const have = ethers.formatUnits(bal, Number(sellTokenDecimals));
            const need = ethers.formatUnits(needAmountBN, Number(sellTokenDecimals));
            throw new Error(`Vault ${shortAddr(vault)} 的 ${sym || "token"} 餘額不足：擁有 ${have}，需要 ${need}`);
        }
        return { vault, sym };
    }

    // ===== Swap via IntegrationManager (Uniswap V2: takeOrder(address,bytes,bytes)) =====
    async function handleSwapViaIM() {
        try {
            if (!signer) throw new Error("Connect wallet first");

            // 用 SWAP 分頁的 CP 或 INVEST 分頁的 CP
            const cpAddrUse = fundCpForSwap || cpAddr;
            if (!ethers.isAddress(cpAddrUse)) throw new Error("Invalid ComptrollerProxy");

            // 解析 IM / Adapter（留空就用 ENZYME 預設）
            const IM = ethers.isAddress(imAddr) ? imAddr : ENZYME.INTEGRATION_MANAGER;
            const ADP = ethers.isAddress(uniAdapter) ? uniAdapter : ENZYME.UNISWAP_ADAPTER;
            if (!ethers.isAddress(IM) || !ethers.isAddress(ADP)) {
                throw new Error("Missing IntegrationManager/Adapter addresses");
            }

            // V2 path：address[]（可填 WETH/USDC/DAI 符號或地址）
            const path = normalizeList(swapPath).split(",").map(toAddressLoose).filter(Boolean);
            if (path.length < 2) throw new Error("Path must contain at least 2 token addresses (V2)");

            // 讀 token decimals → 組 amountIn / minOut
            const ercOut = new ethers.Contract(path[0], ERC20_ABI, provider || signer);
            const ercIn = new ethers.Contract(path[path.length - 1], ERC20_ABI, provider || signer);
            const outDec = await ercOut.decimals().catch(() => 18);
            const inDec = await ercIn.decimals().catch(() => 18);

            const amountIn = ethers.parseUnits(String(sellAmt || "0"), Number(outDec));
            const minAmount = ethers.parseUnits(String(minBuyAmt || "0"), Number(inDec));
            if (amountIn <= 0n) throw new Error("Sell amount must be > 0");

            // --- 重要：V2 的 orderData 形狀（對齊 TA 的 hint）
            // abi.encode(address[] path, uint256 amountIn, uint256 minAmountOut)
            const coder = ethers.AbiCoder.defaultAbiCoder();
            const orderData = coder.encode(["address[]", "uint256", "uint256"], [path, amountIn, minAmount]);

            // selector 必須是 takeOrder(address,bytes,bytes)
            const sel = new ethers.Interface(["function takeOrder(address,bytes,bytes)"]).getFunction("takeOrder").selector;

            // （可選但很實用）先請 Adapter 自我檢查，避免 "_selector invalid"
            const adp = new ethers.Contract(
                ADP,
                ["function parseAssetsForAction(bytes4,bytes) view returns (uint8,uint256,address[],uint256[],address[],uint256[])"],
                provider || signer
            );
            await adp.parseAssetsForAction.staticCall(sel, orderData);

            // 打包 callArgs → Comptroller.callOnExtension(IM, 0, callArgs)
            const callArgs = coder.encode(["address", "bytes4", "bytes"], [ADP, sel, orderData]);

            const cp = new ethers.Contract(cpAddrUse, ["function callOnExtension(address,uint256,bytes)"], signer);
            // Dry-run
            await cp.callOnExtension.staticCall(IM, 0, callArgs);

            // 送交易
            const tx = await cp.callOnExtension(IM, 0, callArgs);
            setStatus({ type: "info", message: "Swap via IM (Uniswap V2)…", hash: tx.hash });
            const rc = await tx.wait();
            setStatus({ type: "success", message: `Swap confirmed. Block ${rc.blockNumber}.`, hash: tx.hash });
        } catch (err) {
            console.error(err);
            // 常見原因：Vault 沒有 path[0] 足夠餘額、該交易對在 Sepolia 上沒有池、或 fund 被 policy 限制
            setStatus({ type: "error", message: shortErr(err) || "Swap reverted. Check vault balances/pair existence/policies." });
        }
    }

    // ===== Denomination helpers =====
    async function detectDenominationAddress(e) {
        try {
            if (e?.preventDefault) e.preventDefault(); // 避免 form reload
            if (!provider) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");
            const ABI = ["function getDenominationAsset() view returns (address)"];
            const cp = new ethers.Contract(cpAddr, ABI, provider);
            const addr = await cp.getDenominationAsset();
            if (!ethers.isAddress(addr)) throw new Error("Getter returned non-address");
            setDenomAddr(ethers.getAddress(addr)); // 強制 checksum
            try {
                const erc = new ethers.Contract(addr, ERC20_ABI, provider);
                const [sym, dec] = await Promise.all([erc.symbol(), erc.decimals()]);
                setDenomSymbol(sym);
                setDenomDecimals(Number(dec));
            } catch { }
            setStatus({ type: "success", message: `Detected denomination asset: ${ethers.getAddress(addr)}` });
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) || "Cannot detect denomination asset on this comptroller. Please paste the token address manually." });
        }
    }

    async function resolveDenominationAddressOrThrow() {
        if (ethers.isAddress(denomAddr)) return denomAddr;
        try {
            const ABI = ["function getDenominationAsset() view returns (address)"];
            const cp = new ethers.Contract(cpAddr, ABI, provider || signer);
            const addr = await cp.getDenominationAsset();
            if (ethers.isAddress(addr)) return addr;
        } catch { }
        throw new Error("Denomination asset unknown. Paste the token address in the Invest panel.");
    }

    async function estimateMinShares(bps = 100) {
        if (!provider) throw new Error("Connect wallet first");
        if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");
        if (!investAmt || Number(investAmt) <= 0) throw new Error("Enter investment amount first");

        const denom = await resolveDenominationAddressOrThrow();
        const erc = new ethers.Contract(denom, ERC20_ABI, provider);
        const d = await erc.decimals();
        const investQty = ethers.parseUnits(investAmt, Number(d));

        const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, provider);
        const gsv = await cp.calcGrossShareValue();

        if (gsv === 0n) {
            setMinShares("0");
            setStatus({ type: "info", message: "Share value is 0; set min shares = 0 for first subscription." });
            return;
        }

        const ONE_E18 = 10n ** 18n;
        const expectedShares = (investQty * ONE_E18) / gsv;
        const min = (expectedShares * BigInt(10000 - bps)) / 10000n;
        setMinShares(ethers.formatUnits(min, 18));
        setStatus({ type: "success", message: `Estimated min shares (~${(100 - bps / 100).toFixed(2)}% of expected)` });
    }

    async function fetchMyShares() {
        try {
            if (!account) throw new Error("Connect wallet first");
            if (!ethers.isAddress(cpAddr)) throw new Error("Invalid ComptrollerProxy");
            const cp = new ethers.Contract(cpAddr, COMPTROLLER_ABI, provider || signer);
            const vault = await cp.getVaultProxy();

            const shares = new ethers.Contract(vault, SHARES_ABI, provider || signer);
            const [dec, sym] = await Promise.all([shares.decimals().catch(() => 18), shares.symbol().catch(() => "SHARE")]);
            const [bal, ts] = await Promise.all([shares.balanceOf(account), shares.totalSupply().catch(() => 0n)]);

            setMyShares({
                amount: ethers.formatUnits(bal, Number(dec)),
                total: ts ? ethers.formatUnits(ts, Number(dec)) : null,
                symbol: sym,
                vault
            });
        } catch (err) {
            console.error(err);
            setStatus({ type: "error", message: shortErr(err) });
        }
    }

    async function ensureAllowance(erc, owner, spender, amt, label = "spender") {
        const cur = await erc.allowance(owner, spender);
        if (cur >= amt) return;
        try {
            const tx = await erc.approve(spender, amt);
            setStatus({ type: "info", message: `Approving ${label}…`, hash: tx.hash });
            await tx.wait();
        } catch (e) {
            const tx0 = await erc.approve(spender, 0);
            setStatus({ type: "info", message: `Reset allowance to 0 for ${label}…`, hash: tx0.hash });
            await tx0.wait();
            const tx1 = await erc.approve(spender, amt);
            setStatus({ type: "info", message: `Re-approving ${label}…`, hash: tx1.hash });
            await tx1.wait();
        }
    }

    // ===== UI =====
    const chainLabel = useMemo(() => {
        if (!chainId) return "";
        return `${networkName || "Network"} (chainId ${chainId})`;
    }, [chainId, networkName]);

    return (
        <div className="min-h-screen text-gray-900">
            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur bg-white/80 border-b">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-2xl bg-blue-600 text-white grid place-items-center shadow-lg">
                            <Coins className="w-5 h-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold leading-tight">OnChain Fund</h1>
                            <p className="text-xs text-gray-500">Transfer • Invest • Swap • Enzyme</p>
                        </div>
                    </div>

                    <button onClick={connect} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white px-4 py-2 shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
                        <Wallet className="w-4 h-4" /> {account ? shortAddr(account) : "Connect"}
                    </button>
                </div>
            </header>

            {/* Main */}
            <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
                {!hasMM && (
                    <div className="p-4 rounded-2xl bg-amber-50 text-amber-900 border border-amber-200 flex gap-3 items-start">
                        <AlertCircle className="w-5 h-5 mt-0.5" />
                        <div>
                            <p className="font-medium">MetaMask not detected.</p>
                            <p className="text-sm opacity-80">Install the extension and refresh this page.</p>
                        </div>
                    </div>
                )}

                {/* Network & balances */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-500">Network</p>
                            <p className="font-medium">{chainLabel || "—"}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-500">Native balance</p>
                            <p className="font-semibold">{Number(nativeBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    {["TRANSFER", "INVEST", "SWAP", "ENZYME"].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setAppTab(tab)}
                            className={`px-4 py-2 rounded-xl border transition ${appTab === tab ? "bg-blue-600 text-white shadow hover:bg-blue-700" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                        >
                            {tab === "TRANSFER" ? "Transfer" : tab === "INVEST" ? "Invest" : tab === "SWAP" ? "Swap" : "Enzyme"}
                        </button>
                    ))}
                </div>

                {/* Panels */}
                <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6">
                    {/* Transfer */}
                    {appTab === "TRANSFER" && (
                        <>
                            <div className="flex gap-2">
                                <button onClick={() => setMode("NATIVE")} className={`px-4 py-2 rounded-xl border transition ${mode === "NATIVE" ? "bg-gray-900 text-white shadow" : "bg-white hover:bg-gray-50"}`}>
                                    Native
                                </button>
                                <button onClick={() => setMode("ERC20")} className={`px-4 py-2 rounded-xl border transition ${mode === "ERC20" ? "bg-gray-900 text-white shadow" : "bg-white hover:bg-gray-50"}`}>
                                    ERC-20
                                </button>
                            </div>

                            {mode === "ERC20" && (
                                <div className="bg-white p-6 rounded-2xl shadow-lg border space-y-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Token contract address</label>
                                    <input
                                        value={tokenAddr}
                                        onChange={(e) => setTokenAddr(e.target.value.trim())}
                                        placeholder="0x..."
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none"
                                    />
                                    {tokenSymbol && (
                                        <p className="text-sm text-gray-500">Detected: <span className="font-medium">{tokenSymbol}</span> (decimals {tokenDecimals})</p>
                                    )}
                                    <div className="flex items-center justify-between text-sm text-gray-500">
                                        <span>Balance</span><span className="font-medium">{tokenBalance}</span>
                                    </div>
                                    <div className="pt-1">
                                        <button onClick={addTokenToWallet} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">Add token to MetaMask</button>
                                    </div>
                                </div>
                            )}

                            <div className="bg-white p-6 rounded-2xl shadow-lg border space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient address</label>
                                    <input
                                        value={recipient}
                                        onChange={(e) => setRecipient(e.target.value.trim())}
                                        placeholder="0x..."
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none"
                                    />
                                    {!recipient || isHexAddress(recipient) ? null : (<p className="text-sm text-amber-700 mt-1">Invalid address</p>)}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Amount {mode === "NATIVE" ? `(ETH)` : tokenSymbol ? `(${tokenSymbol})` : ``}
                                    </label>
                                    <input
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                                        placeholder="0.0"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none"
                                    />
                                </div>
                                <button
                                    onClick={transfer}
                                    disabled={!canTransfer}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white px-4 py-3 shadow hover:bg-blue-700 disabled:opacity-50"
                                >
                                    <Send className="w-4 h-4" />
                                    {mode === "NATIVE" ? "Send ETH" : `Send ${tokenSymbol || "Token"}`}
                                </button>
                            </div>
                        </>
                    )}

                    {/* Invest */}
                    {appTab === "INVEST" && (
                        <div className="bg-white p-6 rounded-2xl shadow-lg border grid gap-4">
                            <h2 className="text-lg font-semibold">Subscribe & Redeem</h2>

                            {/* Subscribe */}
                            <div className="grid gap-2">
                                <label className="text-sm font-medium">ComptrollerProxy</label>
                                <input className="w-full px-4 py-2 border rounded-lg" value={cpAddr} onChange={e => setCpAddr(e.target.value.trim())} placeholder="0x..." />

                                {/* Denomination asset */}
                                <div className="grid gap-2">
                                    <label className="text-sm font-medium">Denomination asset (ERC-20)</label>
                                    <div className="flex gap-2">
                                        <input className="w-full px-4 py-2 border rounded-lg" value={denomAddr} onChange={e => setDenomAddr(e.target.value.trim())} placeholder="0x... (paste if detect doesn't work)" />
                                        <button type="button" onClick={(e) => detectDenominationAddress(e)} className="px-3 py-2 rounded-lg border hover:bg-gray-50">Detect</button>
                                    </div>
                                    {denomSymbol && (
                                        <p className="text-xs text-gray-500">
                                            Detected token: <span className="font-medium">{denomSymbol}</span> (decimals {denomDecimals})
                                        </p>
                                    )}
                                </div>

                                <div className="grid md:grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-sm">Investment amount</label>
                                        <input className="w-full px-4 py-2 border rounded-lg" value={investAmt} onChange={e => setInvestAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1.0" />
                                    </div>
                                    <div>
                                        <label className="text-sm">Min shares</label>
                                        <input className="w-full px-4 py-2 border rounded-lg" value={minShares} onChange={e => setMinShares(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="> 0 (or click Estimate)" />
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <button type="button" onClick={() => estimateMinShares(100)} className="rounded-lg border px-3 py-1.5 hover:bg-gray-50" title="Estimate with 1% slippage buffer">
                                        Estimate min shares (1%)
                                    </button>

                                    <button onClick={handleApproveAndBuyShares} className="rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700">Approve + Buy</button>

                                    {denomAddr && ENZYME.WETH && denomAddr.toLowerCase() === ENZYME.WETH.toLowerCase() && (
                                        <>
                                            <button onClick={handleBuySharesWithEth} className="rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700" title="Pay with native ETH (buySharesWithEth)">
                                                Buy with ETH
                                            </button>
                                            <button type="button" onClick={wrapEthQuick} className="rounded-lg border px-3 py-1.5 hover:bg-gray-50" title="Wrap ETH → WETH using Investment amount">
                                                Wrap ETH → WETH
                                            </button>
                                        </>
                                    )}
                                </div>

                                <p className="text-xs text-gray-500">順序：先 approve（Vault / Comptroller），再 buyShares（或用 ETH 直購）。</p>

                                {/* Shares quick view */}
                                <div className="pt-2">
                                    <button type="button" onClick={fetchMyShares} className="rounded-lg border px-3 py-1.5 hover:bg-gray-50">
                                        Refresh my shares
                                    </button>
                                    {myShares && (
                                        <div className="mt-2 text-sm text-gray-600">
                                            <div>VaultProxy: <span className="font-mono break-all">{myShares.vault}</span></div>
                                            <div>
                                                Your shares: <span className="font-semibold">{myShares.amount}</span> {myShares.symbol}
                                                {myShares.total && <> • Total supply: <span className="font-mono">{myShares.total}</span></>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <hr className="my-2" />

                            {/* Redeem */}
                            <div className="grid gap-2">
                                <label className="text-sm font-medium">VaultProxy（可留空自動從 Comptroller 取得）</label>
                                <input className="w-full px-4 py-2 border rounded-lg" value={vaultAddr} onChange={e => setVaultAddr(e.target.value.trim())} placeholder="0x..." />
                                <label className="text-sm">Shares to redeem</label>
                                <input className="w-full px-4 py-2 border rounded-lg" value={redeemShares} onChange={e => setRedeemShares(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 10.0" />
                                <div className="flex gap-2">
                                    <button onClick={handleRedeemInKind} className="rounded-xl bg-gray-900 text-white px-4 py-2">Redeem In-Kind</button>
                                    <button onClick={handleRedeemSpecific} className="rounded-xl bg-emerald-500 text-white px-4 py-2 hover:bg-emerald-600">Redeem Specific</button>
                                </div>
                                <div className="grid md:grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-sm">Specific assets (comma)</label>
                                        <input className="w-full px-4 py-2 border rounded-lg" value={redeemAssets} onChange={e => setRedeemAssets(e.target.value)} placeholder="0x...,0x... 或 WETH,USDC" />
                                    </div>
                                    <div>
                                        <label className="text-sm">Percentages (sum=10000 or 70,30 / 0.7,0.3)</label>
                                        <input className="w-full px-4 py-2 border rounded-lg" value={redeemPercents} onChange={e => setRedeemPercents(e.target.value)} placeholder="7000,3000 / 70,30 / 0.7,0.3" />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">In-Kind 依持倉比例；Specific 可指定資產與比例（可填小數或百分比，會自動換算成 10000 bps）。</p>
                            </div>
                        </div>
                    )}

                    {/* Swap (Uniswap V2) */}
                    {appTab === "SWAP" && (
                        <div className="bg-white p-6 rounded-2xl shadow-lg border grid gap-3">
                            <h2 className="text-lg font-semibold">Swap via IntegrationManager (Uniswap V2)</h2>

                            <div className="grid md:grid-cols-2 gap-2">
                                <div>
                                    <label className="text-sm">ComptrollerProxy</label>
                                    <input
                                        className="w-full px-4 py-2 border rounded-lg"
                                        value={fundCpForSwap}
                                        onChange={e => setFundCpForSwap(e.target.value.trim())}
                                        placeholder="0x..."
                                    />
                                </div>
                                <div className="flex items-end gap-2">
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                                        onClick={() => setFundCpForSwap(cpAddr)}
                                        title="Use Comptroller from Invest tab"
                                    >
                                        Use Invest CP
                                    </button>
                                </div>
                            </div>

                            <label className="text-sm font-medium">IntegrationManager</label>
                            <input
                                className="w-full px-4 py-2 border rounded-lg"
                                value={imAddr}
                                onChange={e => setImAddr(e.target.value.trim())}
                                placeholder={ENZYME.INTEGRATION_MANAGER}
                            />

                            <label className="text-sm font-medium">Uniswap V2 Adapter</label>
                            <input
                                className="w-full px-4 py-2 border rounded-lg"
                                value={uniAdapter}
                                onChange={e => setUniAdapter(e.target.value.trim())}
                                placeholder={ENZYME.UNISWAP_ADAPTER}
                            />

                            <div className="grid md:grid-cols-3 gap-2">
                                <div>
                                    <label className="text-sm">Sell amount</label>
                                    <input
                                        className="w-full px-4 py-2 border rounded-lg"
                                        value={sellAmt}
                                        onChange={e => setSellAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                                        placeholder="e.g. 0.001"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm">Min receive</label>
                                    <input
                                        className="w-full px-4 py-2 border rounded-lg"
                                        value={minBuyAmt}
                                        onChange={e => setMinBuyAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                                        placeholder="e.g. 20"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm">Path (V2, address[])</label>
                                    <input
                                        className="w-full px-4 py-2 border rounded-lg"
                                        value={swapPath}
                                        onChange={e => setSwapPath(e.target.value)}
                                        placeholder="WETH,USDC 或 0xWETH,0xUSDC"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                                    onClick={() => {
                                        setImAddr(ENZYME.INTEGRATION_MANAGER);
                                        setUniAdapter(ENZYME.UNISWAP_ADAPTER);
                                        setSwapPath("WETH,USDC");
                                        if (!sellAmt) setSellAmt("0.001");
                                        if (!minBuyAmt) setMinBuyAmt("0"); // 先測通路；跑通後再加滑點保護
                                    }}
                                >
                                    Fill example (WETH→USDC)
                                </button>

                                <button onClick={handleSwapViaIM} className="rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700">
                                    Swap
                                </button>
                            </div>

                            <p className="text-xs text-gray-500">
                                V2 使用 <code>orderData = abi.encode(outgoing, minIncoming, path)</code>，
                                selector 固定為 <code>takeOrder(bytes)</code>，path 僅為 <code>address[]</code>（不可帶 fee）。
                            </p>
                        </div>
                    )}


                    {/* Enzyme (Create Fund) */}
                    {appTab === "ENZYME" && (
                        <div className="bg-white p-6 rounded-2xl shadow-lg border space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Create Fund</h2>
                                {chainId && chainId !== REQUIRED_CHAIN_ID && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-amber-700">Wrong network (chainId {chainId}).</span>
                                        <button onClick={switchToSepolia} className="text-sm rounded-lg bg-gray-900 text-white px-3 py-1.5 hover:opacity-90">Switch</button>
                                    </div>
                                )}
                            </div>

                            <div className="grid gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Fund name</label>
                                    <input className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none" value={fundName} onChange={(e) => setFundName(e.target.value)} />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Fund symbol</label>
                                    <input className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none" value={fundSymbol} onChange={(e) => setFundSymbol(e.target.value)} />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Fee recipient (for entrance fee)</label>
                                    <input className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none" placeholder="0x..." value={feeRecipient} onChange={(e) => setFeeRecipient(e.target.value)} />
                                </div>

                                <div className="grid gap-2">
                                    <label className="block text-sm font-medium text-gray-700">Whitelist addresses (comma-separated)</label>
                                    <textarea rows={3} placeholder="0xabc...,0xdef..." className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none" value={whitelist} onChange={(e) => setWhitelist(e.target.value)} />
                                    <div className="flex gap-2">
                                        <button onClick={handleCreateWhitelist} className="rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700">Create whitelist</button>
                                        <input className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none" placeholder="Or paste existing listId (uint256)" value={listId} onChange={(e) => setListId(e.target.value)} />
                                    </div>
                                    <p className="text-xs text-gray-500">You can either create a new whitelist or paste an existing <code>listId</code>.</p>
                                </div>

                                <button className="rounded-xl bg-emerald-500 text-white px-4 py-2 hover:bg-emerald-600" onClick={handleCreateFund}>
                                    Create Fund
                                </button>

                                {createdComptroller && (
                                    <div className="text-sm bg-gray-50 p-4 rounded-xl border">
                                        <p>ComptrollerProxy: <span className="font-mono break-all">{createdComptroller}</span></p>
                                        <p>VaultProxy: <span className="font-mono break-all">{createdVault}</span></p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Status */}
                    {status && (
                        <div
                            className={`rounded-2xl p-4 flex items-start gap-3 border ${status.type === "error" ? "border-red-300 bg-red-50 text-red-900"
                                : status.type === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                    : "border-blue-300 bg-blue-50 text-blue-900"
                                }`}
                        >
                            {status.type === "success" ? <CheckCircle2 className="w-5 h-5 mt-0.5" /> : <AlertCircle className="w-5 h-5 mt-0.5" />}
                            <div>
                                <p className="font-medium">{capitalize(status.type)}</p>
                                <p className="text-sm opacity-90 break-all">{status.message}</p>
                                {status.hash && <p className="text-sm mt-1 opacity-75 break-all">Tx hash: {status.hash}</p>}
                            </div>
                        </div>
                    )}
                </motion.section>
            </main>

            <footer className="text-center text-xs text-gray-500 pb-6">
                Built with React + ethers.js • Use at your own risk
            </footer>
        </div>
    );

    // ===== Create whitelist / fund =====
    async function handleCreateWhitelist() {
        try {
            if (!signer) throw new Error("Connect wallet first");
            const arr = whitelist.split(",").map((s) => s.trim()).filter(Boolean);
            if (arr.length === 0) throw new Error("Whitelist is empty");
            const registry = new ethers.Contract(ENZYME.ADDRESS_LIST_REGISTRY, AddressListRegistryABI, signer);
            const tx = await registry.createList(account, 0, arr);
            setStatus({ type: "info", message: `Creating whitelist…`, hash: tx.hash });
            const receipt = await tx.wait();
            let newId = "";
            try {
                const iface = new ethers.Interface(AddressListRegistryABI);
                for (const log of receipt.logs) {
                    if (log.address.toLowerCase() === ENZYME.ADDRESS_LIST_REGISTRY.toLowerCase()) {
                        const parsed = iface.parseLog(log);
                        if (parsed?.name === "ListCreated") {
                            newId = parsed.args?.listId?.toString?.() || parsed.args?.[0]?.toString?.() || "";
                            break;
                        }
                    }
                }
            } catch { }
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
            for (const [k, v] of Object.entries(ENZYME)) {
                if (!isHexAddress(v)) throw new Error(`ENZYME.${k} is not a valid address`);
            }
            const listIdNum = listId ? (() => { try { return BigInt(listId); } catch { return null; } })() : null;

            const coder = ethers.AbiCoder.defaultAbiCoder();
            const factory = new ethers.Contract(ENZYME.FUND_DEPLOYER, FUND_FACTORY_ABI, signer);

            const feeSettings = coder.encode(["uint256", "address"], [100n, feeRecipient]); // 1%
            const fee_full = coder.encode(["address[]", "bytes[]"], [[ENZYME.ENTRANCE_RATE_DIRECT_FEE], [feeSettings]]);

            const policy_full =
                listIdNum && listIdNum > 0n
                    ? coder.encode(["address[]", "bytes[]"], [[ENZYME.ALLOWED_DEPOSIT_RECIPIENTS_POLICY], [coder.encode(["uint256[]", "bytes[]"], [[listIdNum], []])]])
                    : coder.encode(["address[]", "bytes[]"], [[], []]);

            const empty_cfg = coder.encode(["address[]", "bytes[]"], [[], []]);

            async function tryVariant(label, denom, feeData, polData) {
                const [predComp, predVault] = await factory.createNewFund.staticCall(account, fundName, fundSymbol, denom, 0n, feeData, polData);
                const tx = await factory.createNewFund(account, fundName, fundSymbol, denom, 0n, feeData, polData);
                setStatus({ type: "info", message: `Deploying fund… (${label})`, hash: tx.hash });
                const receipt = await tx.wait();
                return { receipt, predComp, predVault };
            }

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
                        throw new Error(shortErr(eA) || shortErr(eB) || shortErr(eC) || "Fund creation reverted during gas estimation.");
                    }
                }
            }
            const { predComp, predVault } = result;
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

// ===== helpers (string/format) =====
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

// ----- flexible parsing for assets & percents -----
function normalizeList(s) {
    return (s || "")
        .replace(/[，、\n\t\r ]+/g, ",") // 全形逗號/空白/換行 → 逗號
        .replace(/,+/g, ",")
        .replace(/^,|,$/g, "");
}
function toAddressLoose(s) {
    const t = (s || "").trim();
    if (!t) return null;
    // 允許符號名：WETH/USDC/DAI → 由 ENZYME 映射
    const U = t.toUpperCase();
    const map = {
        WETH: ENZYME?.WETH,
        USDC: ENZYME?.USDC,
        DAI: ENZYME?.DAI,
    };
    if (map[U]) { try { return ethers.getAddress(map[U]); } catch { } }
    // 允許任意大小寫地址：轉小寫再 checksum
    try { if (ethers.isAddress(t)) return ethers.getAddress(t); } catch { }
    const lower = t.toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(lower)) { try { return ethers.getAddress(lower); } catch { } }
    return null;
}
function parseAssetsFlexible(input) {
    return normalizeList(input).split(",").filter(Boolean).map(toAddressLoose).filter(Boolean);
}
function parsePercentsToBps(input) {
    const nums = normalizeList(input).split(",").filter(Boolean).map(Number);
    if (nums.length === 0 || nums.some(n => !Number.isFinite(n))) {
        throw new Error("Percentages must be numbers");
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    let bps;
    if (sum > 0.999 && sum < 1.001) {          // 0.7,0.3
        bps = nums.map(n => Math.round(n * 10000));
    } else if (sum > 99.9 && sum < 100.1) {    // 70,30
        bps = nums.map(n => Math.round(n * 100));
    } else {
        bps = nums.map(n => Math.round(n));      // 已是 bps
    }
    // 修正四捨五入造成的總和誤差
    const diff = 10000 - bps.reduce((a, b) => a + b, 0);
    bps[bps.length - 1] += diff;
    if (bps.some(n => n < 0) || bps.reduce((a, b) => a + b, 0) !== 10000) {
        throw new Error("Percentages must sum to 10000");
    }
    return bps;
}
