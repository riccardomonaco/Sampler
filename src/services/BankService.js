/**
 * BankService.js
 * Firebase logic
 */
import { db, storage, auth } from "../firebase"; 
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove, collection, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

class BankService {
  constructor() {
    this.localCache = {};
  }

  async loadAll() {
    try {
      const snapshot = await getDocs(collection(db, "soundBanks"));
      this.localCache = {};
      snapshot.forEach((doc) => {
        this.localCache[doc.id] = doc.data().samples || [];
      });
      return this.localCache;
    } catch (e) {
      console.warn("BankService: Offline mode or Error", e);
      return {};
    }
  }

  async createBank(name) {
    if (this.localCache[name]) return false;
    this.localCache[name] = []; 
    
    try {
      await setDoc(doc(db, "soundBanks", name), {
        createdAt: new Date(),
        owner: auth.currentUser ? auth.currentUser.uid : "anon",
        samples: []
      });
      return true;
    } catch (e) {
      console.error("BankService: Create failed", e);
      delete this.localCache[name];
      return false;
    }
  }

  async addSample(bankName, sampleName, blob, color) {
    if (!auth.currentUser) throw new Error("User not logged in");
    
    // 1. Upload Storage
    const storageRef = ref(storage, `users/${auth.currentUser.uid}/${bankName}/${sampleName}_${Date.now()}.wav`);
    const snapshot = await uploadBytes(storageRef, blob);
    const url = await getDownloadURL(snapshot.ref);

    // 2. Metadata
    const newSample = { name: sampleName, url, color };

    // 3. DB Update
    await updateDoc(doc(db, "soundBanks", bankName), {
      samples: arrayUnion(newSample)
    });

    // 4. Cache Update
    if(this.localCache[bankName]) this.localCache[bankName].push(newSample);
    
    return newSample;
  }

  async deleteSample(bankName, sampleObject) {
    // 1. DB Update
    await updateDoc(doc(db, "soundBanks", bankName), {
      samples: arrayRemove(sampleObject)
    });

    // 2. Storage Delete
    try {
      await deleteObject(ref(storage, sampleObject.url));
    } catch (e) {
      console.warn("File already gone from storage?", e);
    }

    // 3. Cache Update
    if(this.localCache[bankName]) {
      this.localCache[bankName] = this.localCache[bankName].filter(s => s.name !== sampleObject.name);
    }
  }
}

export const bankService = new BankService();