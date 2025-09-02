// EnzymeBuyShares.jsx
import { useState, useEffect } from "react";
import { ethers } from "ethers";

// Minimal ABIs needed by this component
const COMPTROLLER_ABI = [
  "function getDenominationAsset() view returns (address)",
  "function buyShares(uint256 _investmentAmount, uint256 _minSharesQuantity)",
  "function buySharesWithEth(uint256 _minSharesQuantity) payable",
  "function calcGrossShareValue() view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Uses your existing COMPTROLLER_ABI and ERC20_ABI defined elsewhere in App.jsx
function EnzymeBuyShares({
  signer,
  provider,
  account,
  setStatus,
  defaultComptroller,
  defaultVault,
  wethAddr,
}) {
  const [comptrollerAddr, setComptrollerAddr] = useState(
    defaultComptroller || ""
  );
  const [vaultAddr, setVaultAddr] = useState(defaultVault || "");
  const [amount, setAmount] = useState("0.01");
  const [minShares, setMinShares] = useState("0");
  const [denom, setDenom] = useState("");
  const [denomSymbol, setDenomSymbol] = useState("");
  const [denomDecimals, setDenomDecimals] = useState(18);
  const [shareBal, setShareBal] = useState("0");

  useEffect(() => {
    if (!provider || !account || !vaultAddr) return;
    (async () => {
      try {
        const shares = new ethers.Contract(vaultAddr, ERC20_ABI, provider);
        const bal = await shares.balanceOf(account);
        setShareBal(ethers.formatUnits(bal, 18));
      } catch {}
    })();
  }, [provider, account, vaultAddr]);

  async function detectDenom() {
    try {
      if (!signer) throw new Error("Connect wallet first");
      if (!ethers.isAddress(comptrollerAddr))
        throw new Error("Invalid Comptroller address");
      const comp = new ethers.Contract(
        comptrollerAddr,
        COMPTROLLER_ABI,
        signer
      );
      const addr = await comp.getDenominationAsset();
      setDenom(addr);

      try {
        const erc = new ethers.Contract(addr, ERC20_ABI, signer);
        const [sym, dec] = await Promise.all([erc.symbol(), erc.decimals()]);
        setDenomSymbol(sym);
        setDenomDecimals(Number(dec));
        setStatus?.({
          type: "success",
          message: `Denomination: ${sym} (${addr})`,
        });
      } catch {
        setDenomSymbol("");
        setDenomDecimals(18);
        setStatus?.({ type: "info", message: `Denomination: ${addr}` });
      }
    } catch (err) {
      setStatus?.({ type: "error", message: err?.message || String(err) });
    }
  }

  async function onBuy() {
    try {
      if (!signer) throw new Error("Connect wallet first");
      if (!ethers.isAddress(comptrollerAddr))
        throw new Error("Invalid Comptroller address");
      if (!ethers.isAddress(vaultAddr))
        throw new Error("Invalid Vault address");
      if (!(Number(amount) > 0)) throw new Error("Enter amount > 0");

      // Create comptroller contract
      const comp = new ethers.Contract(
        comptrollerAddr,
        [
          "function getDenominationAsset() view returns (address)",
          "function buyShares(uint256 _investmentAmount, uint256 _minSharesQuantity)",
          "function buySharesWithEth(uint256 _minSharesQuantity) payable",
        ],
        signer
      );

      // Get denomination on-chain every time for safety
      const denomAddr = await comp.getDenominationAsset();

      // Determine path
      const isWethDenom =
        wethAddr &&
        typeof wethAddr === "string" &&
        denomAddr.toLowerCase() === wethAddr.toLowerCase();

      // Slippage guard (shares usually 18 decimals)
      const minQty = ethers.parseUnits(minShares || "0", 18);

      if (isWethDenom) {
        // ========= WETH DENOM → ETH PATH =========
        // amount is ETH to send along
        const value = ethers.parseEther(amount);

        // Dry-run to surface clear revert reasons
        await comp.buySharesWithEth.staticCall(minQty, { value });

        // Real tx
        const tx = await comp.buySharesWithEth(minQty, { value });
        setStatus?.({
          type: "info",
          message: "buySharesWithEth sent…",
          hash: tx.hash,
        });
        await tx.wait();
        setStatus?.({
          type: "success",
          message: "Subscribed with ETH (wrapped to WETH under the hood).",
        });
      } else {
        // ========= NON-WETH DENOM → ERC-20 PATH =========
        // Need ERC-20 approve to the Vault, then buyShares

        // Minimal ERC-20 ABI for approve/allowance/decimals
        const erc = new ethers.Contract(
          denomAddr,
          [
            "function decimals() view returns (uint8)",
            "function allowance(address,address) view returns (uint256)",
            "function approve(address,uint256) returns (bool)",
          ],
          signer
        );

        const dec = await erc.decimals();
        const investAmt = ethers.parseUnits(amount, dec);

        // Ensure allowance
        const allowance = await erc.allowance(account, vaultAddr);
        if (allowance < investAmt) {
          const txA = await erc.approve(vaultAddr, investAmt);
          setStatus?.({
            type: "info",
            message: "Approve sent…",
            hash: txA.hash,
          });
          await txA.wait();
        }

        // Dry-run
        await comp.buyShares.staticCall(investAmt, minQty);

        // Real tx
        const txB = await comp.buyShares(investAmt, minQty);
        setStatus?.({
          type: "info",
          message: "buyShares sent…",
          hash: txB.hash,
        });
        await txB.wait();
        setStatus?.({
          type: "success",
          message: "Subscribed with ERC-20 denomination.",
        });
      }

      // (Optional) refresh share balance UI here…
    } catch (err) {
      const msg =
        err?.reason || err?.data?.message || err?.message || String(err);
      setStatus?.({ type: "error", message: msg });
    }
  }

  async function preflight() {
    try {
      if (!signer) throw new Error("Connect wallet first");
      if (!ethers.isAddress(comptrollerAddr))
        throw new Error("Invalid Comptroller address");
      if (!ethers.isAddress(vaultAddr))
        throw new Error("Invalid Vault address");
      if (!(Number(amount) > 0)) throw new Error("Enter amount > 0");

      // 1) Basic contract sanity
      const codeComp = await provider.getCode(comptrollerAddr);
      if (!codeComp || codeComp === "0x")
        throw new Error("Comptroller address is not a contract");

      const VAULT_ABI_MIN = ["function getAccessor() view returns (address)"];
      const vault = new ethers.Contract(vaultAddr, VAULT_ABI_MIN, provider);
      const accessor = (await vault.getAccessor()).toLowerCase();
      if (accessor !== comptrollerAddr.toLowerCase()) {
        throw new Error(
          "Vault accessor != this Comptroller (addresses are mismatched)."
        );
      }

      // 2) Detect denomination
      const COMP_ABI_MIN = [
        "function getDenominationAsset() view returns (address)",
        "function buyShares(uint256,uint256)",
        "function buySharesWithEth(uint256) payable",
      ];
      const comp = new ethers.Contract(comptrollerAddr, COMP_ABI_MIN, signer);
      const denomAddr = await comp.getDenominationAsset();
      const isWethDenom =
        wethAddr && denomAddr.toLowerCase() === wethAddr.toLowerCase();

      // If user selected ETH path but denom is NOT WETH, fail early with a clear message
      if (
        !isWethDenom &&
        Number(amount) > 0 &&
        /* you're about to use ETH path */ true
      ) {
        throw new Error(
          "Fund denomination is not WETH. Use ERC-20 path: approve denom → buyShares()."
        );
      }
      // Try to get symbol/decimals if ERC-20
      let denomSym = "Token",
        denomDec = 18;
      try {
        const erc = new ethers.Contract(
          denomAddr,
          [
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)",
          ],
          provider
        );
        [denomSym, denomDec] = await Promise.all([
          erc.symbol(),
          erc.decimals(),
        ]);
      } catch {}

      console.log("[preflight] denom:", denomAddr, denomSym, denomDec);

      // 3) Dry-run the intended path
      if (wethAddr && denomAddr.toLowerCase() === wethAddr.toLowerCase()) {
        // ETH path
        const minQty = ethers.parseUnits(minShares || "0", 18);
        const value = ethers.parseEther(amount);

        // IMPORTANT: staticCall with the same value you’ll send
        await comp.buySharesWithEth.staticCall(minQty, { value });
        console.log("[preflight] ETH path staticCall OK");
      } else {
        // ERC-20 path
        const ercABI = [
          "function allowance(address,address) view returns (uint256)",
          "function decimals() view returns (uint8)",
        ];
        const erc = new ethers.Contract(denomAddr, ercABI, provider);
        const dec = denomDec || (await erc.decimals());
        const investAmt = ethers.parseUnits(amount, dec);

        // Allowance is checked by fund code but staticCall won’t check allowance, so we only precheck amount formatting
        const minQty = ethers.parseUnits(minShares || "0", 18);
        await comp.buyShares.staticCall(investAmt, minQty);
        console.log(
          "[preflight] ERC-20 path staticCall OK (remember to approve before buy)"
        );
      }

      setStatus?.({
        type: "success",
        message: "Preflight passed. You can proceed to Buy.",
      });
    } catch (err) {
      const msg =
        err?.reason || err?.data?.message || err?.message || String(err);
      console.error("[preflight]", err);
      setStatus?.({ type: "error", message: "Preflight failed: " + msg });
    }
  }
  

  return (
    <div className="card p-5 grid gap-3">
      <h3 className="text-base font-semibold">Buy Shares</h3>

      <label className="text-sm">ComptrollerProxy</label>
      <input
        className="input"
        value={comptrollerAddr}
        onChange={(e) => setComptrollerAddr(e.target.value.trim())}
        placeholder="0x..."
      />

      <label className="text-sm">VaultProxy</label>
      <input
        className="input"
        value={vaultAddr}
        onChange={(e) => setVaultAddr(e.target.value.trim())}
        placeholder="0x..."
      />

      <button
        type="button"
        onClick={detectDenom}
        className="btn btn-secondary w-max text-sm"
      >
        Detect Denomination
      </button>
      {denom && (
        <p className="text-sm text-gray-600">
          Denomination: {denomSymbol || "Token"} ({denom.slice(0, 6)}…
          {denom.slice(-4)})
        </p>
      )}

      <div className="grid gap-2">
        <label className="text-sm">
          Amount (
          {denomSymbol ||
            (denom && denom.toLowerCase() === (wethAddr || "").toLowerCase()
              ? "ETH"
              : "token")}
          )
        </label>
        <input
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm">Min shares (slippage guard)</label>
        <input
          className="input"
          value={minShares}
          onChange={(e) => setMinShares(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>

      <button type="button" onClick={onBuy} className="btn btn-primary">
        Buy
      </button>

      <div className="text-sm text-gray-600 mt-1">
        Your share balance: <span className="font-medium">{shareBal}</span>
      </div>
      <button
        type="button"
        onClick={preflight}
        className="btn btn-ghost text-sm"
      >
        Preflight
      </button>
    </div>
  );
}

export default EnzymeBuyShares;
