import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getAddress, isAddress } from 'viem';
import { api, setAuthToken, getAuthToken } from '../api/client.js';

const STORAGE_KEY = 'otero:auth:v1';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

async function requestAccount() {
  if (!window.ethereum) throw new Error('no ethereum wallet found');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts?.length) throw new Error('wallet connection rejected');
  return getAddress(accounts[0]);
}

async function signMessage(address, message) {
  return window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  });
}

export function AuthProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [role, setRole] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [ready, setReady] = useState(false);

  const restore = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setReady(true);
      return;
    }
    try {
      const me = await api.getMe();
      setAddress(getAddress(me.address));
      setCanEdit(Boolean(me.canEdit));
      setRole(me.role || (me.canEdit ? 'admin' : 'user'));
    } catch {
      setAuthToken(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setAuthToken(stored);
    } catch {}
    restore();
  }, [restore]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccounts = (accounts) => {
      if (!accounts?.length || !accounts[0]) {
        logout();
      } else if (address && getAddress(accounts[0]) !== address) {
        logout();
      }
    };
    window.ethereum.on?.('accountsChanged', handleAccounts);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccounts);
    };
  }, [address]);

  const login = useCallback(async () => {
    setConnecting(true);
    try {
      const account = await requestAccount();
      const message = await api.getNonce(account);
      const signature = await signMessage(account, message);
      const result = await api.verifyWallet(account, message.split('Nonce: ').pop(), signature);
      const normalized = getAddress(result.address);
      setAuthToken(result.token);
      try { localStorage.setItem(STORAGE_KEY, result.token); } catch {}
      setAddress(normalized);
      setCanEdit(Boolean(result.canEdit));
      setRole(result.role || (result.canEdit ? 'admin' : 'user'));
      return normalized;
    } finally {
      setConnecting(false);
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setAddress(null);
    setCanEdit(false);
    setRole(null);
  }, []);

  const value = {
    address,
    role,
    canEdit,
    isAuthenticated: Boolean(address),
    connecting,
    ready,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
