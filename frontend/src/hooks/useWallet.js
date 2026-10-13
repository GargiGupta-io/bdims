import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, JsonRpcProvider } from "ethers";
import { deployments, LOCAL_CHAIN_ID, LOCAL_RPC } from "../lib/config.js";
import { getContracts } from "../lib/contracts.js";

const DISCONNECTED = { status: "disconnected", mode: null, provider: null, signer: null, address: null, chainId: null };

// Two ways in:
//  - MetaMask: the real thing, used on Sepolia and for the demo.
//  - Local test account: only on a local Hardhat chain. Hardhat's node holds
//    the keys of its 20 test accounts, so the app can act as any of them with
//    no wallet. For development and quick demos only.
export function useWallet() {
  const [state, setState] = useState(DISCONNECTED);
  const [error, setError] = useState(null);
  const listening = useRef(false);

  const connectMetaMask = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask isn't installed in this browser.");
      return;
    }
    try {
      setState((s) => ({ ...s, status: "connecting" }));
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const { chainId } = await provider.getNetwork();
      setState({ status: "ready", mode: "metamask", provider, signer, address: await signer.getAddress(), chainId: Number(chainId) });
    } catch (e) {
      setState(DISCONNECTED);
      setError(e?.code === "ACTION_REJECTED" ? "Connection request was cancelled." : e?.shortMessage || e?.message);
    }
  }, []);

  const connectLocal = useCallback(async (index) => {
    setError(null);
    try {
      const provider = new JsonRpcProvider(LOCAL_RPC, LOCAL_CHAIN_ID, { staticNetwork: true });
      provider.pollingInterval = 1000;
      const signer = await provider.getSigner(index);
      setState({ status: "ready", mode: "local", provider, signer, address: await signer.getAddress(), chainId: LOCAL_CHAIN_ID });
    } catch (e) {
      setError(`Can't reach the local chain at ${LOCAL_RPC}. Is "npm run node" running?`);
    }
  }, []);

  const disconnect = useCallback(() => setState(DISCONNECTED), []);

  // MetaMask: follow account and network switches made in the extension.
  useEffect(() => {
    if (state.mode !== "metamask" || !window.ethereum || listening.current) return;
    listening.current = true;
    const onChange = () => connectMetaMask();
    window.ethereum.on("accountsChanged", onChange);
    window.ethereum.on("chainChanged", onChange);
    return () => {
      window.ethereum.removeListener("accountsChanged", onChange);
      window.ethereum.removeListener("chainChanged", onChange);
      listening.current = false;
    };
  }, [state.mode, connectMetaMask]);

  const switchChain = useCallback(async (chainId) => {
    const hex = `0x${chainId.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e?.code === 4902 && chainId === LOCAL_CHAIN_ID) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: "Hardhat Local", rpcUrls: [LOCAL_RPC], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
        });
      } else {
        setError(e?.message);
      }
    }
  }, []);

  const deployment = state.chainId ? deployments[state.chainId] : null;
  const contracts = useMemo(() => (deployment && state.signer ? getContracts(deployment, state.signer) : null), [deployment, state.signer]);

  return { ...state, error, deployment, contracts, connectMetaMask, connectLocal, disconnect, switchChain };
}
