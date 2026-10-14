/**
 * ব্লাড সেবা - ফায়ারবেস কনফিগারেশন ও ক্লাউড ডাটাবেস সার্ভিস
 * Firebase SDK v10 (Official Modular CDN)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/**
 * --------------------------------------------------------------------------
 * ফায়ারবেস কনফিগারেশন (আপনার Firebase Console থেকে পাওয়া তথ্য এখানে দিন)
 * --------------------------------------------------------------------------
 * ১. https://console.firebase.google.com/ এ যান এবং একটি নতুন প্রজেক্ট তৈরি করুন।
 * ২. "Web App" (</> আইকন) এ ক্লিক করে আপনার অ্যাপের নাম দিন।
 * ৩. নিচের অবজেক্টে আপনার প্রাপ্ত কীগুলো (Keys) বসিয়ে দিন।
 * ৪. Firebase Console থেকে Firestore Database তৈরি করুন (Start in test mode)।
 */
export const defaultFirebaseConfig = {
  apiKey: "AIzaSyCW2ns4kCquTeiNFZsUfpU6kvmqTIroRa4",
  authDomain: "redhero-e86ba.firebaseapp.com",
  projectId: "redhero-e86ba",
  storageBucket: "redhero-e86ba.firebasestorage.app",
  messagingSenderId: "1098348249539",
  appId: "1:1098348249539:web:d364466b1504b0abdc7d76",
  measurementId: "G-BG3YY6ZBL5"
};

// Check if user saved custom config in localStorage via the UI settings modal
function getActiveConfig() {
  const custom = localStorage.getItem('blood_seva_firebase_custom_config');
  if (custom) {
    try {
      return JSON.parse(custom);
    } catch (e) {
      console.error("Invalid custom firebase config", e);
    }
  }
  return defaultFirebaseConfig;
}

export function saveCustomFirebaseConfig(config) {
  localStorage.setItem('blood_seva_firebase_custom_config', JSON.stringify(config));
  window.location.reload();
}

export function clearCustomFirebaseConfig() {
  localStorage.removeItem('blood_seva_firebase_custom_config');
  window.location.reload();
}

const activeConfig = getActiveConfig();

// Verify if the config has actual keys or still default placeholder
export function isFirebaseConfigured() {
  return activeConfig.apiKey && 
         activeConfig.apiKey !== "YOUR_API_KEY" && 
         activeConfig.projectId && 
         activeConfig.projectId !== "YOUR_PROJECT_ID";
}

let app = null;
let db = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(activeConfig);
    db = getFirestore(app);
    console.log("✅ Firebase Firestore Connected Successfully!");
  } catch (err) {
    console.error("Firebase connection error:", err);
  }
} else {
  console.warn("⚠️ Firebase is not yet configured with real keys. Running in smart hybrid mode.");
}

export { db };

/**
 * --------------------------------------------------------------------------
 * Real-time Firestore Listeners & Database Operations
 * --------------------------------------------------------------------------
 */

// Subscribe to real-time donors collection
export function subscribeToDonors(onSuccess, onError) {
  if (!db) {
    return null;
  }

  const donorsCol = collection(db, "donors");
  return onSnapshot(donorsCol, (snapshot) => {
    const donorsList = [];
    snapshot.forEach((docSnap) => {
      donorsList.push({ id: docSnap.id, ...docSnap.data() });
    });
    onSuccess(donorsList);
  }, (err) => {
    console.error("Firestore snapshot error:", err);
    if (onError) onError(err);
  });
}

// Add or save donor to Firestore
export async function saveDonorToCloud(donor) {
  if (!db) {
    throw new Error("ফায়ারবেস এখনও কনফিগার করা হয়নি।");
  }
  const donorRef = doc(db, "donors", donor.id);
  await setDoc(donorRef, {
    ...donor,
    updatedAt: Date.now()
  });
}

// Update donor data (e.g., mark donated, approve, cooldown)
export async function updateDonorInCloud(donorId, updates) {
  if (!db) {
    throw new Error("ফায়ারবেস এখনও কনফিগার করা হয়নি।");
  }
  const donorRef = doc(db, "donors", donorId);
  await updateDoc(donorRef, {
    ...updates,
    updatedAt: Date.now()
  });
}

// Delete donor from cloud
export async function deleteDonorFromCloud(donorId) {
  if (!db) {
    throw new Error("ফায়ারবেস এখনও কনফিগার করা হয়নি।");
  }
  const donorRef = doc(db, "donors", donorId);
  await deleteDoc(donorRef);
}

// Subscribe to real-time admins collection
export function subscribeToAdmins(onSuccess, onError) {
  if (!db) {
    return null;
  }
  const adminsCol = collection(db, "admins");
  return onSnapshot(adminsCol, (snapshot) => {
    const list = [];
    snapshot.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...docSnap.data() });
    });
    onSuccess(list);
  }, (err) => {
    console.error("Firestore admins snapshot error:", err);
    if (onError) onError(err);
  });
}

// Add or save admin to Firestore
export async function saveAdminToCloud(admin) {
  if (!db) {
    throw new Error("ফায়ারবেস এখনও কনফিগার করা হয়নি।");
  }
  const adminRef = doc(db, "admins", admin.id);
  await setDoc(adminRef, {
    ...admin,
    updatedAt: Date.now()
  });
}

// Delete admin from cloud
export async function deleteAdminFromCloud(adminId) {
  if (!db) {
    throw new Error("ফায়ারবেস এখনও কনফিগার করা হয়নি।");
  }
  const adminRef = doc(db, "admins", adminId);
  await deleteDoc(adminRef);
}

