# 如何通過 ComptrollerLib 與 Uniswap 交互

`ComptrollerLib` 作為基金的中央控制器，它不直接與外部協議（如 Uniswap）通信。它通過一個名為 `IntegrationManager` 的標準化擴展，以一種安全且模組化的方式進行所有外部交互。

整個流程是通過層層嵌套的函數調用來實現的，確保了協議的安全性和可擴展性。

### 核心組件

1.  **`ComptrollerLib`**: 基金的「大腦」，也是所有操作的統一入口和權限控制器。
2.  **`IntegrationManager`**: 作為 `ComptrollerLib` 的一個擴展，它扮演著路由器的角色，專門管理和調用所有與外部協議集成的「適配器」（Adapters）。
3.  **`UniswapV2ExchangeAdapter.sol` / `UniswapV3Adapter.sol`**: 這些是具體的「適配器」合約。它們封裝了與 Uniswap 交互的底層細節，例如如何構建交換路徑、調用哪個 `swap` 函數等。

### 交互流程

以下是從基金發起一筆 WETH 到 DAI 的交換交易的詳細步驟。整個過程的核心是從內到外構建一個嵌套的調用數據（`calldata`）。

#### 第 1 步：準備 Adapter 的調用數據 (最內層)

首先，需要準備 `Adapter` (例如 `UniswapV2ExchangeAdapter`) 的調用數據。這份數據在傳遞給 `IntegrationManager` 時，會被拆解為兩個核心部分：

1.  **`selector`**: 要在 Adapter 上調用的函數選擇器，例如 `takeOrder` 的 `bytes4` 選擇器。
2.  **`integrationData`**: 傳遞給 Adapter 函數的參數，它本身是 ABI 編碼後的數據。對於 `takeOrder` 來說，這就是 `_orderData`。

- **`integrationData` (`_orderData`) 的內容**:
  - `abi.encode(outgoingAssetAmount, minIncomingAssetAmount, path)`
    - `outgoingAssetAmount`: 要賣出的 WETH 數量。
    - `minIncomingAssetAmount`: 期望最少收到的 DAI 數量（用於滑點保護）。
    - `path`: Uniswap 交換路徑，例如 `[wethAddress, daiAddress]`。

**示例代碼 (概念):**
```solidity
// 這是傳遞給 takeOrder 的參數，也是我們需要的 integrationData
bytes memory orderData = abi.encode(wethAmount, minDaiAmount, path);

// takeOrder 的函數選擇器
bytes4 takeOrderSelector = UniswapV2ExchangeAdapter.takeOrder.selector;
```

#### 第 2 步：準備 IntegrationManager 的調用數據 (中間層)

接下來，需要將 **第 1 步** 的 `Adapter` 地址、`selector` 和 `integrationData` 打包成 `IntegrationManager` 所期望的 `_callArgs` 格式。

`ComptrollerLib` 在調用 `IntegrationManager` 時，會傳入一個 `_callArgs` 參數，`IntegrationManager` 會將其解碼為 `(address adapter, bytes4 selector, bytes memory integrationData)`。因此，我們需要將這三者進行緊密打包的 ABI 編碼。

- **目標**: 準備 `IntegrationManager` 需要的 `_callArgs` (在腳本中稱之為 `integrationManagerCalldata`)。
- **結構**: `abi.encode(address adapter, bytes4 selector, bytes integrationData)`
- **參數**:
  - `adapter`: `UniswapV2ExchangeAdapter` 合約的地址。
  - `selector`: `UniswapV2ExchangeAdapter.takeOrder.selector`。
  - `integrationData`: **第 1 步**中準備的 `orderData`。

**示例代碼:**
```solidity
bytes memory integrationManagerCalldata = abi.encode(
    uniswapAdapterAddress,
    UniswapV2ExchangeAdapter.takeOrder.selector,
    orderData // orderData 是 abi.encode(wethAmount, minDaiAmount, path)
);
```

#### 第 3 步：調用 ComptrollerLib 的入口 Function (最外層)

最後，基金經理（或代表基金經理的合約）調用 `ComptrollerLib` 的通用入口函數 `callOnExtension`，將**第 2 步**的數據作為最終參數傳入。

- **目標合約**: `VaultProxy` (代理到 `ComptrollerLib` 的實現)
- **目標 Function**: `callOnExtension(address _extension, uint256 _actionId, bytes calldata _callData)`
- **參數**:
  - `_extension`: `IntegrationManager` 合約的地址。
  - `_actionId`: 一個枚舉值，用於指定 `IntegrationManager` 的操作。此處為 `0`，代表 `IntegrationManager.IntegrationAction.CallOnIntegration`。
  - `_callData`: **第 2 步**中生成的 `integrationManagerCalldata`。

### Ethers.js 交互範例

以下是如何使用 Ethers.js 來構建與上述流程完全相同的交易。Ethers.js 提供了更現代的 API 和更好的類型支持。

```javascript
// --- 準備 ABI (可以使用更簡潔的 Human-Readable ABI) ---
const uniswapAdapterAbi = [
    "function takeOrder(bytes _orderData)"
];

// IntegrationManager 的 ABI 不再需要，因為我們是手動編碼傳給它的參數
// const integrationManagerAbi = [ ... ];

const comptrollerAbi = [
    "function callOnExtension(address _extension, uint256 _actionId, bytes _callData)"
];

// --- 參數設定 ---
const { ethers } = require("ethers"); // 引入 ethers.js

// 連接到以太坊網絡
const provider = new ethers.providers.JsonRpcProvider("https://mainnet.infura.io/v3/YOUR_PROJECT_ID");

// 合約地址 (請替換為您的實際地址)
const vaultProxyAddress = "0x..."; // 基金的 VaultProxy 地址
const integrationManagerAddress = "0x..."; // IntegrationManager 地址
const uniswapAdapterAddress = "0x..."; // UniswapV2ExchangeAdapter 地址
const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

// 交易參數
const wethAmount = ethers.utils.parseEther("1"); // 賣出 1 WETH
const minDaiAmount = ethers.utils.parseUnits("3000", 18); // 期望最少收到 3000 DAI (DAI 也是 18 位小數)
const path = [wethAddress, daiAddress];

// --- 創建 Interface 實例 ---
const uniswapAdapterInterface = new ethers.utils.Interface(uniswapAdapterAbi);
const comptrollerInterface = new ethers.utils.Interface(comptrollerAbi);


// --- 第 1 步：準備 Adapter 的調用數據 (selector 和 integrationData) ---

// 1a. 準備 takeOrder 的內部參數 (這就是 integrationData)
const orderData = ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256', 'address[]'],
    [wethAmount, minDaiAmount, path]
);

// 1b. 從 Adapter Interface 中獲取 takeOrder 的函數選擇器 (selector)
const takeOrderSelector = uniswapAdapterInterface.getSighash("takeOrder");

console.log("Order Data (integrationData):", orderData);
console.log("Take Order Selector:", takeOrderSelector);


// --- 第 2 步：準備 IntegrationManager 的調用數據 ---
// 根據 IntegrationManager 的要求，將 adapter, selector, 和 integrationData 進行 ABI 編碼
const integrationManagerCalldata = ethers.utils.defaultAbiCoder.encode(
    ['address', 'bytes4', 'bytes'],
    [uniswapAdapterAddress, takeOrderSelector, orderData]
);

console.log("IntegrationManager Calldata:", integrationManagerCalldata);

// --- 第 3 步：準備 ComptrollerLib 的最終交易數據 ---

// IntegrationManager.IntegrationAction.CallOnIntegration 的枚舉值是 0
const callOnIntegrationActionId = 0; 

const finalCalldata = comptrollerInterface.encodeFunctionData("callOnExtension", [
    integrationManagerAddress,
    callOnIntegrationActionId,
    integrationManagerCalldata
]);

console.log("Final Calldata for VaultProxy:", finalCalldata);

// --- 第 4 步：發送交易 ---
async function sendTransaction() {
    // 需要一個錢包實例來簽名交易
    // const privateKey = "YOUR_PRIVATE_KEY";
    // const wallet = new ethers.Wallet(privateKey, provider);
    const fromAddress = "0x..."; // 基金經理的地址 (應與 wallet 的地址相同)

    const txObject = {
        // from: fromAddress, // from 是可選的，ethers 會自動從錢包中獲取
        to: vaultProxyAddress,
        data: finalCalldata,
        gasLimit: 500000, // 預估的 Gas Limit，應根據實際情況調整
    };
    
    console.log("Transaction Object:", txObject);

    // 在實際應用中，你會對此交易進行簽名並發送
    // try {
    //     const txResponse = await wallet.sendTransaction(txObject);
    //     console.log("Transaction Hash:", txResponse.hash);
    //     const receipt = await txResponse.wait();
    //     console.log("Transaction was mined in block:", receipt.blockNumber);
    // } catch (error) {
    //     console.error("Transaction failed:", error);
    // }
}

// sendTransaction();
```

### 總結與調用鏈圖示

整個調用鏈可以總結如下：

```
基金經理 -> VaultProxy.callOnExtension(
                _extension: IntegrationManager地址,
                _actionId: 0, // CallOnIntegration
                _callData: abi.encode(
                    // --- IntegrationManager 的 _callArgs ---
                    _adapter: UniswapAdapter地址,
                    _selector: takeOrder的selector,
                    _integrationData: abi.encode(
                        // --- 交換參數 ---
                        wethAmount,
                        minDaiAmount,
                        [wethAddress, daiAddress]
                    )
                )
            )
```

### 設計理念

- **安全**: `ComptrollerLib` 只信任已註冊的擴展，`IntegrationManager` 只信任已註冊的適配器。每一層都進行嚴格的權限控制。
- **模組化**: 增加對新協議的支持只需開發並註冊一個新的 Adapter，無需修改核心邏輯。
- **原子性**: 整個複雜的調用鏈在一個區塊鏈交易中原子性地完成。