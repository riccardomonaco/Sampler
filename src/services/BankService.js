/**
 * BankService.js
 * Firebase logic
 */
import { db, storage, auth } from "../firebase";
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove, collection, getDocs, deleteDoc } from "firebase/firestore";
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

  async deleteBank(bankName) {
    if (!auth.currentUser) throw new Error("User not logged in");

    const bankSamples = this.localCache[bankName] || [];

    try {
      const deletePromises = bankSamples.map(sample => {
        let fileRef;

        // A. Se abbiamo il percorso sicuro, usiamo quello
        if (sample.fullPath) {
          fileRef = ref(storage, sample.fullPath);
        }
        // B. Fallback per vecchi sample: Estraiamo il path dall'URL HTTP
        else if (sample.url) {
          try {
            // L'URL è tipo: .../o/users%2Fuid%2Ffile.wav?alt=...
            // Prendiamo la parte tra '/o/' e '?' e decodifichiamo i caratteri speciali
            const pathStart = sample.url.indexOf('/o/') + 3;
            const pathEnd = sample.url.indexOf('?');
            // Se l'URL è strano, prendiamo tutto dopo /o/
            const rawPath = pathEnd > -1 ? sample.url.substring(pathStart, pathEnd) : sample.url.substring(pathStart);
            const decodedPath = decodeURIComponent(rawPath);

            fileRef = ref(storage, decodedPath);
          } catch (err) {
            console.warn("Impossibile estrarre path dall'URL:", sample.name);
            return Promise.resolve();
          }
        }

        if (fileRef) {
          return deleteObject(fileRef).catch(e => {
            console.warn(`File ${sample.name} già rimosso o non trovato`, e);
          });
        }
        return Promise.resolve();
      });

      await Promise.all(deletePromises);

      await deleteDoc(doc(db, "soundBanks", bankName));

      delete this.localCache[bankName];

      return true;
    } catch (e) {
      console.error("BankService: Delete bank failed", e);
      return false;
    }
  }

  async addSample(bankName, sampleName, blob, color) {
    if (!auth.currentUser) throw new Error("User not logged in");

    const storageRef = ref(storage, `users/${auth.currentUser.uid}/${bankName}/${sampleName}_${Date.now()}.wav`);
    const snapshot = await uploadBytes(storageRef, blob);
    const url = await getDownloadURL(snapshot.ref);

    const newSample = {
      name: sampleName,
      url,
      color,
      fullPath: snapshot.ref.fullPath
    };

    await updateDoc(doc(db, "soundBanks", bankName), {
      samples: arrayUnion(newSample)
    });

    if (this.localCache[bankName]) this.localCache[bankName].push(newSample);

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
    if (this.localCache[bankName]) {
      this.localCache[bankName] = this.localCache[bankName].filter(s => s.name !== sampleObject.name);
    }
  }
}

export const bankService = new BankService();