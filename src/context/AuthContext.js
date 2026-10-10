import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStorageData = async () => {
      try {
        const userData = await AsyncStorage.getItem('migme_user');
        const roleData = await AsyncStorage.getItem('migme_role');
        if (userData && roleData) {
          setUser(JSON.parse(userData));
          setRole(roleData);
        }
      } catch (e) {
        console.error('Failed to load user', e);
      } finally {
        setLoading(false);
      }
    };
    loadStorageData();
  }, []);

  const login = async (userData, userRole) => {
    setUser(userData);
    setRole(userRole);
    await AsyncStorage.setItem('migme_user', JSON.stringify(userData));
    await AsyncStorage.setItem('migme_role', userRole);
  };

  const logout = async () => {
    setUser(null);
    setRole(null);
    await AsyncStorage.removeItem('migme_user');
    await AsyncStorage.removeItem('migme_role');
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
