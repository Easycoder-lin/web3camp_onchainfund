
// --- Step 0: Configuration and Constants for Sepolia Network ---
const ENZYME = {
  FUND_DEPLOYER: "0x9D2C19a267caDA33da70d74aaBF9d2f75D3CdC14",
  ADDRESS_LIST_REGISTRY: "0x6D0b3882dF46A81D42cCce070ce5E46ea26BAcA5",
  ALLOWED_DEPOSIT_RECIPIENTS_POLICY: "0x0eD7E38C4535989e392843884326925B4469EB5A",
  ENTRANCE_RATE_DIRECT_FEE: "0xA7259E45c7Be47a5bED94EDc252FADB09769a326",
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

const FUND_DEPLOYER_ABI = [
    "function createNewFund(address _fundOwner, string _fundName, string _fundSymbol, (address denominationAsset, uint256 sharesActionTimelog, bytes feeManagerConfigData, bytes policyManagerConfigData, tuple[] extensionsConfig) _comptrollerConfig) returns (address comptrollerProxy, address vaultProxy)",
    "event NewFundCreated(address indexed creator, address indexed fundOwner, address comptrollerProxy, address vaultProxy, string fundName, string fundSymbol)"
];

const COMPTROLLER_ABI = [
    "function getVaultProxy() view returns (address)",
    "function calcGav() view returns (uint256)",
    "function calcGrossShareValue() view returns (uint256)",
    "function buyShares(uint256 _investmentAmount, uint256 _minSharesQuantity)",
    "function getDenominationAsset() view returns (address)",
    "function redeemSharesInKind(address _recipient, uint256 _sharesQuantity, address[] _additionalAssets, address[] _assetsToSkip)"
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

const ADDRESS_LIST_REGISTRY_ABI = [
    "function createList(address owner, uint8 updateType, address[] initialItems) returns (uint256 listId)",
    "event ListCreated(uint256 indexed listId, address indexed owner, uint8 updateType, address[] initialItems)"
];

// --- Step 1: State and UI Elements ---
let provider, signer, userAddress;
let currentFund = {};

const connectButton = document.getElementById('connectButton');
const walletInfo = document.getElementById('wallet-info');
const createFundButton = document.getElementById('createFundButton');
const loadFundButton = document.getElementById('loadFundButton');
const investButton = document.getElementById('investButton');
const redeemButton = document.getElementById('redeemButton');
const logArea = document.getElementById('log-area');

// --- Step 2: Helper Functions ---
function log(message) {
    console.log(message);
    logArea.innerHTML = `> ${message}\n` + logArea.innerHTML;
}

function disableButtons(...buttons) {
    buttons.forEach(btn => btn.disabled = true);
}

function enableButtons(...buttons) {
    buttons.forEach(btn => btn.disabled = false);
}

// --- Step 3: Core DApp Logic ---

// 3.1: Wallet Connection
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        log('MetaMask is not installed!');
        return;
    }

    try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        
        const network = await provider.getNetwork();
        if (network.chainId !== 11155111) { // 11155111 is Sepolia
            log('🔴 Please switch to the Sepolia test network in MetaMask.');
            alert('Please switch to the Sepolia test network in MetaMask.');
            return;
        }

        walletInfo.textContent = `Connected: ${userAddress.substring(0, 6)}...${userAddress.substring(38)} (Sepolia)`;
        connectButton.textContent = 'Connected';
        log(`✅ Wallet connected successfully to Sepolia network.`);
        enableButtons(createFundButton);
    } catch (error) {
        log(`🔴 Wallet connection failed: ${error.message}`);
    }
}

// 3.2: Fund Creation
async function handleCreateFund() {
    log("🚀 Starting fund creation process...");
    disableButtons(createFundButton);

    try {
        const fundName = document.getElementById('fundName').value;
        const fundSymbol = document.getElementById('fundSymbol').value;
        const whitelistCSV = document.getElementById('whitelistAddresses').value;

        if (!fundName || !fundSymbol || !whitelistCSV) {
            throw new Error("Please fill in all fund details.");
        }
        const whitelistAddresses = whitelistCSV.split(',').map(addr => addr.trim());

        // --- Step 1 of 2: Create Whitelist ---
        log("1. Creating investor whitelist...");
        const addressListRegistry = new ethers.Contract(ENZYME.ADDRESS_LIST_REGISTRY, ADDRESS_LIST_REGISTRY_ABI, signer);
        const createListTx = await addressListRegistry.createList(userAddress, 0, whitelistAddresses);
        log(`Transaction sent to create list: ${createListTx.hash}`);
        
        const listReceipt = await createListTx.wait();
        const listCreatedEvent = listReceipt.events.find(e => e.event === 'ListCreated');
        if (!listCreatedEvent) {
            throw new Error("Could not find ListCreated event in transaction receipt.");
        }
        const listId = listCreatedEvent.args.listId;
        log(`✅ Whitelist created successfully. List ID: ${listId.toString()}`);

        // --- Step 2 of 2: Deploy Fund with Config ---
        log("2. Preparing fund configuration...");
        const defaultAbiCoder = ethers.utils.defaultAbiCoder;

        const entranceFeeSettings = defaultAbiCoder.encode(['uint256', 'address'], [100, userAddress]);
        const policySettingsData = defaultAbiCoder.encode(['uint256[]', 'bytes[]'], [[listId], []]);
        const feeManagerConfigData = defaultAbiCoder.encode(['address[]', 'bytes[]'], [[ENZYME.ENTRANCE_RATE_DIRECT_FEE], [entranceFeeSettings]]);
        const policyManagerConfigData = defaultAbiCoder.encode(['address[]', 'bytes[]'], [[ENZYME.ALLOWED_DEPOSIT_RECIPIENTS_POLICY], [policySettingsData]]);

        const comptrollerConfig = {
            denominationAsset: ENZYME.WETH,
            sharesActionTimelog: 0,
            feeManagerConfigData,
            policyManagerConfigData,
            extensionsConfig: []
        };

        log("3. Deploying the fund via FundDeployer...");
        const fundDeployer = new ethers.Contract(ENZYME.FUND_DEPLOYER, FUND_DEPLOYER_ABI, signer);
        const createFundTx = await fundDeployer.createNewFund(userAddress, fundName, fundSymbol, comptrollerConfig);
        log(`Fund deployment transaction sent: ${createFundTx.hash}`);
        
        const fundReceipt = await createFundTx.wait();
        const fundCreatedEvent = fundReceipt.events.find(e => e.event === 'NewFundCreated');
        if (!fundCreatedEvent) throw new Error("Could not find NewFundCreated event.");
        
        const { comptrollerProxy, vaultProxy } = fundCreatedEvent.args;
        log("🎉 Fund created successfully!");
        log(`   Comptroller Proxy: ${comptrollerProxy}`);
        log(`   Vault Proxy: ${vaultProxy}`);
        document.getElementById('comptrollerAddress').value = comptrollerProxy;

    } catch (error) {
        log(`🔴 Fund creation failed: ${error.message}`);
    } finally {
        enableButtons(createFundButton);
    }
}

// 3.3: Loading and Displaying Fund Data
async function handleLoadFund() {
    const comptrollerAddress = document.getElementById('comptrollerAddress').value;
    if (!ethers.utils.isAddress(comptrollerAddress)) {
        log("🔴 Invalid Comptroller Address.");
        return;
    }
    log(`🔍 Loading data for fund: ${comptrollerAddress}`);

    try {
        const comptroller = new ethers.Contract(comptrollerAddress, COMPTROLLER_ABI, provider);
        const denominationAssetAddress = await comptroller.getDenominationAsset();
        const denominationAssetContract = new ethers.Contract(denominationAssetAddress, ERC20_ABI, provider);
        
        const [gav, grossShareValue, symbol, decimals] = await Promise.all([
            comptroller.calcGav(),
            comptroller.calcGrossShareValue(),
            denominationAssetContract.symbol(),
            denominationAssetContract.decimals()
        ]);

        currentFund = {
            comptrollerAddress,
            comptroller,
            denominationAssetAddress,
            denominationAssetContract,
            symbol,
            decimals,
        };
        
        const infoDiv = document.getElementById('fund-info-content');
        infoDiv.innerHTML = `
            <p><strong>Comptroller:</strong> ${comptrollerAddress}</p>
            <p><strong>Denomination Asset:</strong> ${symbol} (${denominationAssetAddress})</p>
            <p><strong>Gross Asset Value (GAV):</strong> ${ethers.utils.formatUnits(gav, decimals)} ${symbol}</p>
            <p><strong>Gross Share Value:</strong> ${ethers.utils.formatUnits(grossShareValue, decimals)} ${symbol}</p>
        `;
        document.getElementById('denominationSymbol').textContent = symbol;
        document.getElementById('fund-details').style.display = 'block';
        log(`✅ Fund data loaded successfully.`);
    } catch(error) {
        log(`🔴 Failed to load fund data: ${error.message}`);
        document.getElementById('fund-details').style.display = 'none';
    }
}

// 3.4: Investing (Subscribing)
async function handleInvest() {
    log("🚀 Starting investment process...");
    disableButtons(investButton);
    try {
        const amountStr = document.getElementById('investmentAmount').value;
        if (!amountStr || parseFloat(amountStr) <= 0) {
            throw new Error("Please enter a valid investment amount.");
        }

        const investmentAmount = ethers.utils.parseUnits(amountStr, currentFund.decimals);
        
        log(`1. Approving ${currentFund.symbol} spending...`);
        const vaultProxyAddress = await currentFund.comptroller.connect(signer).getVaultProxy();
        const assetWithSigner = currentFund.denominationAssetContract.connect(signer);
        
        const allowance = await assetWithSigner.allowance(userAddress, vaultProxyAddress);
        if (allowance.lt(investmentAmount)) {
             const approveTx = await assetWithSigner.approve(vaultProxyAddress, investmentAmount);
             log(`Approval transaction sent: ${approveTx.hash}`);
             await approveTx.wait();
             log("✅ Approval confirmed.");
        } else {
            log("✅ Sufficient allowance already exists.");
        }
        
        log("2. Calling buyShares...");
        const comptrollerWithSigner = currentFund.comptroller.connect(signer);
        const buySharesTx = await comptrollerWithSigner.buyShares(investmentAmount, 0); // minShares set to 0 for simplicity
        log(`buyShares transaction sent: ${buySharesTx.hash}`);
        await buySharesTx.wait();
        
        log("🎉 Investment successful!");
        handleLoadFund();
    } catch (error) {
        log(`🔴 Investment failed: ${error.message}`);
    } finally {
        enableButtons(investButton);
    }
}

// 3.5: Redeeming Shares
async function handleRedeem() {
    log("🚀 Starting redemption process...");
    disableButtons(redeemButton);
    try {
        const amountStr = document.getElementById('redeemAmount').value;
         if (!amountStr || parseFloat(amountStr) <= 0) {
            throw new Error("Please enter a valid amount of shares to redeem.");
        }
        const redeemAmount = ethers.utils.parseUnits(amountStr, 18);

        log("1. Calling redeemSharesInKind...");
        const comptrollerWithSigner = currentFund.comptroller.connect(signer);
        
        const redeemTx = await comptrollerWithSigner.redeemSharesInKind(userAddress, redeemAmount, [], []);
        log(`Redemption transaction sent: ${redeemTx.hash}`);
        await redeemTx.wait();

        log("🎉 Redemption successful!");
        handleLoadFund();
    } catch (error) {
        log(`🔴 Redemption failed: ${error.message}`);
    } finally {
        enableButtons(redeemButton);
    }
}

// --- Step 4: Event Listeners ---
connectButton.addEventListener('click', connectWallet);
createFundButton.addEventListener('click', handleCreateFund);
loadFundButton.addEventListener('click', handleLoadFund);
investButton.addEventListener('click', handleInvest);
redeemButton.addEventListener('click', handleRedeem);

window.addEventListener('load', () => {
    log("DApp loaded. Please connect your wallet to the Sepolia network.");
});