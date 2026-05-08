import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyAw7sgwP4Q5cxz8z7N4Y8g5_BB7hdgzWG8',
  authDomain: 'starmind-72daa.firebaseapp.com',
  databaseURL: 'https://beedraw.firebaseio.com',
  projectId: 'starmind-72daa',
  storageBucket: 'beedraw',
  messagingSenderId: '372397827204',
  appId: '1:372397827204:web:721c4afb9dedd9caee8ed1',
  measurementId: 'G-ZJH1PCLQRE',
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Initialize Realtime Database
export const database = getDatabase(app)

// Initialize Firebase Storage
export const storage = getStorage(app)
