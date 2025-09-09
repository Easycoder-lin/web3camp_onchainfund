# 🌐 Web3Camp On-Chain Fund

An experimental **on-chain fund management dApp** built during Web3Camp.  
This project integrates **Enzyme Finance** smart contracts on Sepolia testnet and provides a **React + Vite + Tailwind frontend** for creating, managing, and interacting with decentralized funds.

---

## ✨ Features

- **Create a Fund**  
  Deploy a new fund via Enzyme’s FundDeployer contract.

- **Invest in a Fund**  
  Buy shares using ETH or ERC-20 tokens.

- **Redeem Shares**  
  Withdraw assets in-kind.

- **Swap Assets**  
  Swap tokens via Uniswap V2 through Enzyme’s IntegrationManager.

- **View Fund Details**  
  Display fund addresses, holdings, and transaction logs.

---

## 🛠 Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, ethers.js  
- **Backend Contracts:** Solidity, Enzyme Finance Protocol  
- **Network:** Sepolia Testnet  
- **Wallet:** MetaMask  

---

## 📦 Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/Easycoder-lin/web3camp_onchainfund.git
cd web3camp_onchainfund
```
### 2. Install Dependencies
```bash
npm install
# or
pnpm install
```
### 3. Configure Environment Variables
Create a .env file in the root directory:
```bash
VITE_INFURA_API_KEY=your_infura_key
VITE_ALCHEMY_API_KEY=your_alchemy_key
VITE_REQUIRED_CHAIN_ID=11155111   # Sepolia chain ID
```
### 4. Run Development Server
```bash
npm run dev
```
The app will be available at http://localhost:3306.

#### Contract Information (Sepolia)

- **FundDeployer:** 0x...

- **IntegrationManager:** 0x...

- **UniswapV2Adapter:** 0x...

- **Your Fund ComptrollerProxy:** 0x...

- **Your Fund VaultProxy:** 0x...

### 🚀 Usage Guide

1. Connect your MetaMask wallet (set to Sepolia).

2. Create a fund by specifying fee recipient and settings.

3. Invest by buying shares with ETH.

4. Redeem shares in-kind to withdraw assets.

5. Swap assets via Uniswap adapter through the IntegrationManager.

### 🤝 Contributing

We follow Angular Commit Message Conventions for commit messages and branch names:

Branch format:
```bash
<type>/<short-description>
```

Example: feat/user-auth, fix/swap-path-encoding

Allowed types: feat, fix, docs, style, refactor, test, chore

Please open a Pull Request for all contributions.

### 📜 License

MIT License.
Feel free to use and modify this project for learning and experimentation.

### 🙌 Acknowledgements

- Enzyme Finance
 for the fund infrastructure

- Uniswap V2
 for on-chain liquidity

- Web3Camp
 for guidance and support