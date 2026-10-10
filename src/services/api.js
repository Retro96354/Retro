import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy
} from "firebase/firestore";
import { db } from '../firebaseConfig';

export const getMenuItems = async (clientId) => {
  const q = query(collection(db, "menuItems"), where("clientId", "==", clientId));
  const querySnapshot = await getDocs(q);
  const items = [];
  querySnapshot.forEach((doc) => {
    items.push({ _id: doc.id, ...doc.data() });
  });
  return items;
};

export const createOrder = async (orderData, clientId) => {
  try {
    const docRef = await addDoc(collection(db, "orders"), {
      ...orderData,
      clientId,
      createdAt: new Date().toISOString(),
      status: "Active"
    });
    return { id: docRef.id, ...orderData };
  } catch (error) {
    console.error("Error creating order: ", error);
    throw error;
  }
};

export const getOrders = async (clientId, statusFilter = 'All') => {
  const ordersRef = collection(db, "orders");
  let q;
  if (statusFilter === 'All') {
    q = query(ordersRef, where("clientId", "==", clientId));
  } else {
    q = query(ordersRef, where("clientId", "==", clientId), where("status", "==", statusFilter));
  }
  const querySnapshot = await getDocs(q);
  const orders = [];
  querySnapshot.forEach((doc) => {
    orders.push({ id: doc.id, ...doc.data() });
  });
  return orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const updateOrderStatus = async (orderId, newStatus) => {
  const orderRef = doc(db, "orders", orderId);
  await updateDoc(orderRef, { status: newStatus });
  return { id: orderId, status: newStatus };
};
