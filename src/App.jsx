import React, { useState, useEffect } from 'react';
import { isConnected, getAddress, signTransaction, getNetworkDetails, requestAccess } from '@stellar/freighter-api';
import { Horizon, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';
import {
  Wallet,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Copy,
  ExternalLink,
  LogOut,
  Coins,
  Info,
  ShieldAlert
} from 'lucide-react';
import './App.css';

// Initialize Stellar Horizon Server for Testnet
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const horizonServer = new Horizon.Server(HORIZON_TESTNET_URL);

// Stellar Testnet network passphrase
const STELLAR_TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function App() {
  // Connection states
  const [hasFreighter, setHasFreighter] = useState(true);
  const [walletAddress, setWalletAddress] = useState(null);
  const [network, setNetwork] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Balance states
  const [balance, setBalance] = useState(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isUnfunded, setIsUnfunded] = useState(false);

  // Faucet states
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);

  // Transaction form states
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState({
    state: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    message: '',
    txHash: null
  });

  // Check if Freighter extension is installed on mount
  useEffect(() => {
    const checkWallet = async () => {
      try {
        const connectedRes = await isConnected();
        const isWalletConnected = connectedRes && (connectedRes.isConnected === true || connectedRes === true);
        setHasFreighter(!!isWalletConnected);
      } catch (err) {
        console.error("Error checking Freighter extension:", err);
        setHasFreighter(false);
      }
    };
    checkWallet();
  }, []);

  // Monitor network status when walletAddress is available
  useEffect(() => {
    if (walletAddress) {
      updateNetworkDetails();
      fetchBalance(walletAddress);
      
      // Setup polling interval for balance (every 15 seconds)
      const interval = setInterval(() => {
        fetchBalance(walletAddress);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [walletAddress]);

  const updateNetworkDetails = async () => {
    try {
      const details = await getNetworkDetails();
      if (details && !details.error) {
        setNetwork(details.network);
      } else if (details && details.error) {
        console.error("Network details error:", details.error);
      }
    } catch (err) {
      console.error("Error fetching network details:", err);
    }
  };

  const connectWallet = async () => {
    setIsConnecting(true);
    setTxStatus({ state: 'idle', message: '', txHash: null });
    try {
      // 1. Check if Freighter is available
      const connectedRes = await isConnected();
      const isWalletConnected = connectedRes && (connectedRes.isConnected === true || connectedRes === true);
      if (!isWalletConnected) {
        setHasFreighter(false);
        setIsConnecting(false);
        return;
      }

      // 2. Request Freighter authorization and retrieve address
      const accessRes = await requestAccess();
      if (accessRes && accessRes.error) {
        throw new Error(accessRes.error.message || accessRes.error || "Failed to retrieve address.");
      }

      const publicKey = accessRes?.address || accessRes;
      if (publicKey && typeof publicKey === 'string') {
        setWalletAddress(publicKey);
        showToast("Connected to Freighter Wallet!");
      } else {
        throw new Error("Could not retrieve wallet address. Make sure Freighter is unlocked and authorized.");
      }
    } catch (err) {
      console.error("Connection failed:", err);
      setTxStatus({
        state: 'error',
        message: err.message || "Failed to connect to Freighter Wallet. Please unlock your wallet and authorize the app.",
        txHash: null
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setBalance(null);
    setNetwork(null);
    setDestination('');
    setAmount('');
    setIsUnfunded(false);
    setTxStatus({ state: 'idle', message: '', txHash: null });
    showToast("Wallet disconnected.");
  };

  const fetchBalance = async (address) => {
    if (!address) return;
    setIsLoadingBalance(true);
    try {
      const account = await horizonServer.loadAccount(address);
      const nativeBalanceObj = account.balances.find((b) => b.asset_type === 'native');
      if (nativeBalanceObj) {
        setBalance(parseFloat(nativeBalanceObj.balance).toFixed(2));
        setIsUnfunded(false);
      } else {
        setBalance('0.00');
        setIsUnfunded(true);
      }
    } catch (err) {
      // Horizon returns 404 for accounts not yet created/funded on testnet
      if (err.response && err.response.status === 404) {
        setBalance('0.00');
        setIsUnfunded(true);
      } else {
        console.error("Error loading account balance:", err);
      }
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const fundWithFaucet = async () => {
    if (!walletAddress) return;
    setIsFaucetLoading(true);
    setTxStatus({ state: 'idle', message: '', txHash: null });
    
    try {
      const response = await fetch(`https://friendbot.stellar.org/?addr=${walletAddress}`);
      if (!response.ok) {
        throw new Error(`Friendbot failed with status ${response.status}`);
      }
      
      showToast("Friendbot funded 10,000 XLM successfully!");
      await fetchBalance(walletAddress);
    } catch (err) {
      console.error("Friendbot funding error:", err);
      setTxStatus({
        state: 'error',
        message: "Failed to request XLM from Friendbot faucet. Please try again in a few moments.",
        txHash: null
      });
    } finally {
      setIsFaucetLoading(false);
    }
  };

  const sendPayment = async (e) => {
    e.preventDefault();
    if (!walletAddress) return;
    
    // 1. Basic UI Validations
    if (!destination.trim() || destination.length !== 56 || !destination.startsWith('G')) {
      setTxStatus({
        state: 'error',
        message: "Invalid Destination Address. Must be a valid 56-character Stellar public key starting with 'G'.",
        txHash: null
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setTxStatus({
        state: 'error',
        message: "Amount must be a positive number greater than 0.",
        txHash: null
      });
      return;
    }

    if (parseFloat(amount) >= parseFloat(balance)) {
      setTxStatus({
        state: 'error',
        message: `Insufficient funds. Your balance is ${balance} XLM (need additional XLM for transaction fees).`,
        txHash: null
      });
      return;
    }

    setTxStatus({
      state: 'loading',
      message: 'Preparing transaction and requesting wallet signature...',
      txHash: null
    });

    try {
      // 2. Fetch the network details from Freighter to verify testnet match
      const details = await getNetworkDetails();
      const userNetwork = details?.network || 'TESTNET';

      if (userNetwork !== 'TESTNET' && userNetwork !== 'Test Net') {
        throw new Error("Freighter wallet is not set to Testnet. Please switch Freighter's network settings to Testnet.");
      }

      // 3. Load source account sequence number
      const sourceAccount = await horizonServer.loadAccount(walletAddress);

      // 4. Build Stellar Payment Transaction
      const baseFee = await horizonServer.fetchBaseFee().catch(() => 100);
      
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: baseFee.toString(),
        networkPassphrase: STELLAR_TESTNET_PASSPHRASE
      })
        .addOperation(
          Operation.payment({
            destination: destination.trim(),
            asset: Asset.native(),
            amount: parseFloat(amount).toFixed(7) // Stellar requires up to 7 decimal precision
          })
        )
        .setTimeout(180)
        .build();

      const xdr = transaction.toXDR();

      // 5. Sign the XDR using Freighter wallet
      setTxStatus({
        state: 'loading',
        message: 'Awaiting signature approval from Freighter wallet extension...',
        txHash: null
      });

      const signedResult = await signTransaction(xdr, { 
        network: 'TESTNET',
        networkPassphrase: STELLAR_TESTNET_PASSPHRASE
      });
      
      let signedXdr = '';
      if (typeof signedResult === 'string') {
        signedXdr = signedResult;
      } else if (signedResult && signedResult.signedTxXdr) {
        signedXdr = signedResult.signedTxXdr;
      } else if (signedResult && signedResult.error) {
        throw new Error(signedResult.error.message || signedResult.error || "Freighter transaction signing failed.");
      } else {
        throw new Error("Freighter transaction signing was rejected or failed.");
      }

      // 6. Submit the signed transaction envelope to the Horizon Testnet Server
      setTxStatus({
        state: 'loading',
        message: 'Submitting signed transaction to Stellar Testnet Horizon...',
        txHash: null
      });

      // Reconstruct transaction object from signed envelope XDR to submit
      const signedTransaction = TransactionBuilder.fromXDR(signedXdr, STELLAR_TESTNET_PASSPHRASE);
      const result = await horizonServer.submitTransaction(signedTransaction);

      // 7. Success state
      setTxStatus({
        state: 'success',
        message: `Successfully transferred ${amount} XLM to ${destination.slice(0, 6)}...${destination.slice(-6)}!`,
        txHash: result.hash
      });

      // Clear form inputs
      setDestination('');
      setAmount('');
      
      // Update balance
      fetchBalance(walletAddress);
      showToast("Transaction submitted successfully!");

    } catch (err) {
      console.error("Transaction failed:", err);
      let errorMsg = err.message || "An unexpected error occurred during submission.";
      
      // Inspect Horizon result codes if available
      if (err.response && err.response.data && err.response.data.extras && err.response.data.extras.result_codes) {
        const codes = err.response.data.extras.result_codes;
        if (codes.transaction === 'tx_bad_seq') {
          errorMsg = "Transaction failed: Sequence number mismatch. Please refresh your balance and try again.";
        } else if (codes.operations && codes.operations.includes('op_no_destination')) {
          errorMsg = "Transaction failed: Destination account does not exist. Hint: Send at least 1 XLM to fund/create the destination account.";
        } else if (codes.transaction === 'tx_insufficient_balance') {
          errorMsg = "Transaction failed: Insufficient balance to cover the payment amount and network fee.";
        } else {
          errorMsg = `Horizon transaction error: ${codes.transaction} (${codes.operations ? codes.operations.join(', ') : 'none'})`;
        }
      }

      setTxStatus({
        state: 'error',
        message: errorMsg,
        txHash: null
      });
    }
  };

  const copyAddress = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopySuccess(true);
    showToast("Address copied to clipboard!");
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Toast notification system
  const [toastText, setToastText] = useState('');
  const [showToastAlert, setShowToastAlert] = useState(false);

  const showToast = (text) => {
    setToastText(text);
    setShowToastAlert(true);
    setTimeout(() => {
      setShowToastAlert(false);
    }, 3500);
  };

  return (
    <div className="app-container">
      {/* Toast Notice */}
      {showToastAlert && (
        <div className="toast toast-success">
          <CheckCircle size={18} />
          <span>{toastText}</span>
        </div>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="logo-container">
          <Coins className="logo-icon" size={32} />
          <h1 className="logo-text">EventStar Pay</h1>
        </div>
        <div className="network-badge">
          Stellar Testnet
        </div>
      </header>

      {/* Main App Grid */}
      <main className="dashboard-grid">
        {/* Left Side: Wallet Manager */}
        <section className="left-panel">
          {!walletAddress ? (
            // Wallet Disconnected View
            <div className="glass-card wallet-card">
              <div className="wallet-illustration">
                <Wallet size={36} />
              </div>
              <h2 className="card-title" style={{ border: 'none', padding: 0, justifyContent: 'center', marginBottom: '0.5rem' }}>
                Connect Freighter
              </h2>
              <p className="wallet-desc">
                {!hasFreighter 
                  ? "Freighter wallet extension was not detected. Please install it to interact with the Stellar dApp." 
                  : "Connect your Freighter web extension wallet to view your testnet XLM balance and submit payments."
                }
              </p>
              
              {hasFreighter ? (
                <button 
                  onClick={connectWallet} 
                  disabled={isConnecting}
                  className="btn btn-primary"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="spinner" size={18} />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wallet size={18} />
                      Connect Wallet
                    </>
                  )}
                </button>
              ) : (
                <a 
                  href="https://www.freighter.app/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-primary"
                >
                  <ExternalLink size={18} />
                  Install Freighter
                </a>
              )}
            </div>
          ) : (
            // Wallet Connected View
            <div className="glass-card wallet-card-connected">
              <h2 className="card-title">
                <Wallet size={20} />
                My Account
              </h2>

              {/* Account Address details */}
              <div className="wallet-info-group">
                <div className="info-label">Wallet Address</div>
                <div className="address-row">
                  <span className="wallet-address-text">
                    {walletAddress.slice(0, 8)}...{walletAddress.slice(-8)}
                  </span>
                  <button onClick={copyAddress} className="btn-icon" title="Copy Address">
                    <Copy size={16} />
                  </button>
                </div>
              </div>

              {/* Wallet network match warning */}
              {network && network !== 'TESTNET' && network !== 'Test Net' && (
                <div className="status-card status-card-error" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem' }}>
                  <ShieldAlert size={18} style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ fontSize: '0.8rem' }}>
                    <strong>Warning</strong>: Freighter is set to {network}. Switch network in Freighter settings to Testnet.
                  </div>
                </div>
              )}

              {/* Balance Card */}
              <div className="balance-display">
                <div className="info-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>XLM Balance</span>
                  <button 
                    onClick={() => fetchBalance(walletAddress)} 
                    disabled={isLoadingBalance} 
                    className="btn-icon" 
                    style={{ padding: '0.15rem' }}
                    title="Refresh Balance"
                  >
                    <RefreshCw size={12} className={isLoadingBalance ? "spinner" : ""} />
                  </button>
                </div>
                <div className="balance-amount">
                  {isLoadingBalance && balance === null ? (
                    <span className="balance-loader"></span>
                  ) : (
                    <>
                      {balance} <span className="balance-ticker">XLM</span>
                    </>
                  )}
                </div>

                {isUnfunded && (
                  <div className="balance-unfunded">
                    <AlertTriangle size={14} />
                    <span>Account not yet funded on testnet.</span>
                  </div>
                )}
              </div>

              {/* Action buttons (Faucet / Disconnect) */}
              <button 
                onClick={fundWithFaucet} 
                disabled={isFaucetLoading} 
                className="btn btn-secondary"
                style={{ marginBottom: '0.75rem', position: 'relative' }}
              >
                {isFaucetLoading ? (
                  <>
                    <RefreshCw className="spinner" size={18} />
                    Requesting Faucet...
                  </>
                ) : (
                  <>
                    <Coins size={18} />
                    Fund with Faucet (10k XLM)
                  </>
                )}
              </button>

              <button onClick={disconnectWallet} className="btn btn-danger">
                <LogOut size={18} />
                Disconnect
              </button>
            </div>
          )}

          {/* Quick Help box */}
          <div className="instruction-box">
            <h4>
              <Info size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '0.4rem', color: '#06b6d4' }} />
              Quick Instructions
            </h4>
            <ol>
              <li>Unlock your Freighter extension and choose "Testnet" network.</li>
              <li>Connect your wallet to this dashboard.</li>
              <li>Use the Faucet button to request 10,000 testnet XLM if your balance is zero.</li>
              <li>Enter a destination address (e.g. create a 2nd Freighter account or use a test address) and enter the payment amount.</li>
              <li>Confirm the Freighter sign request to submit the transaction.</li>
            </ol>
          </div>
        </section>

        {/* Right Side: Payment Form & Transaction Logger */}
        <section className="right-panel">
          <div className="glass-card" style={{ minHeight: '430px' }}>
            <h2 className="card-title">
              <Send size={20} />
              Send XLM Payment
            </h2>

            <form onSubmit={sendPayment}>
              {/* Destination Input */}
              <div className="form-group">
                <label className="form-label" htmlFor="destination">Destination Public Key</label>
                <div className="input-wrapper">
                  <Wallet className="input-icon" size={18} />
                  <input
                    id="destination"
                    type="text"
                    placeholder="e.g. GBX2R... (56 chars public key)"
                    className="form-input form-input-monospaced"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    disabled={!walletAddress || txStatus.state === 'loading'}
                    required
                  />
                </div>
              </div>

              {/* Amount Input */}
              <div className="form-group">
                <label className="form-label" htmlFor="amount">Amount (XLM)</label>
                <div className="input-wrapper">
                  <Coins className="input-icon" size={18} />
                  <input
                    id="amount"
                    type="number"
                    step="0.00001"
                    min="0.00001"
                    placeholder="e.g. 10.5"
                    className="form-input"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!walletAddress || txStatus.state === 'loading'}
                    required
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!walletAddress || txStatus.state === 'loading' || isUnfunded}
                className="btn btn-primary"
                style={{ marginTop: '0.5rem' }}
              >
                {txStatus.state === 'loading' && txStatus.message.includes('Submitting') ? (
                  <>
                    <RefreshCw className="spinner" size={18} />
                    Submitting to Ledger...
                  </>
                ) : txStatus.state === 'loading' ? (
                  <>
                    <RefreshCw className="spinner" size={18} />
                    Awaiting Signature...
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    Submit Payment
                  </>
                )}
              </button>
            </form>

            {/* Real-time Status Card Feedback */}
            {txStatus.state !== 'idle' && (
              <div className="status-area">
                {txStatus.state === 'loading' && (
                  <div className="status-card status-card-loading">
                    <RefreshCw className="spinner" size={20} style={{ marginTop: '2px' }} />
                    <div className="status-content">
                      <div className="status-title">Transaction Processing</div>
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>{txStatus.message}</p>
                    </div>
                  </div>
                )}

                {txStatus.state === 'success' && (
                  <div className="status-card status-card-success">
                    <CheckCircle size={20} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div className="status-content">
                      <div className="status-title">Transaction Successful!</div>
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>{txStatus.message}</p>
                      {txStatus.txHash && (
                        <div>
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${txStatus.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tx-hash-link"
                          >
                            View on Stellar.Expert Explorer
                            <ExternalLink size={14} />
                          </a>
                          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6ee7b7' }}>
                            Hash: <span className="tx-hash-preview">{txStatus.txHash.slice(0, 16)}...{txStatus.txHash.slice(-16)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {txStatus.state === 'error' && (
                  <div className="status-card status-card-error">
                    <AlertTriangle size={20} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div className="status-content">
                      <div className="status-title">Transaction Failed</div>
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>{txStatus.message}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
