        import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
        import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

        const firebaseConfig = {
            apiKey: "AIzaSyBawDWPi-NvWl3bKyGVIFi-v9FX7yHraEI",
            authDomain: "gimbo-dc910.firebaseapp.com",
            projectId: "gimbo-dc910",
            storageBucket: "gimbo-dc910.firebasestorage.app",
            messagingSenderId: "294864961933",
            appId: "1:294864961933:web:61d6c4086c09a506bf3dc4",
            measurementId: "G-XSBFDNVXKD"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);

        // Expose to global scope so the main script can use them
        window._gymAuth = auth;
        window._gymSignIn = signInWithEmailAndPassword;
