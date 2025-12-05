// let pc;
// let dataChannel;
// let socket;
// let isOfferer = false;

// const statusDiv = document.getElementById("status");
// const chatDiv = document.getElementById("chat");

// function log(msg) {
//     chatDiv.innerHTML += `<div>${msg}</div>`;
// }

// document.getElementById("start").onclick = () => {
//     start();
// };

// async function start() {
//     statusDiv.innerText = "Connexion en cours...";
    
//     // Connexion WebSocket
//     socket = new WebSocket("ws://localhost:8080"); // serveur signalisation
//     socket.onopen = () => {
//         statusDiv.innerText = "Connecté à la signalisation";
        
//         // Décider qui crée l'offre
//         isOfferer = Math.random() > 0.5;
//         if (isOfferer) makeOffer();
//     };

//     socket.onmessage = async (msg) => {
//         const data = JSON.parse(msg.data);

//         if (data.offer) {
//             await pc.setRemoteDescription(data.offer);
//             const answer = await pc.createAnswer();
//             await pc.setLocalDescription(answer);
//             socket.send(JSON.stringify({ answer }));
//         }

//         if (data.answer) {
//             await pc.setRemoteDescription(data.answer);
//         }

//         if (data.candidate) {
//             await pc.addIceCandidate(data.candidate);
//         }
//     };

//     initPeer();
// }

// function initPeer() {
//     pc = new RTCPeerConnection();

//     pc.onicecandidate = (event) => {
//         if (event.candidate) {
//             socket.send(JSON.stringify({ candidate: event.candidate }));
//         }
//     };

//     if (isOfferer) {
//         dataChannel = pc.createDataChannel("chat");
//         setupDataChannel();
//     }

//     pc.ondatachannel = (event) => {
//         dataChannel = event.channel;
//         setupDataChannel();
//     };
// }

// function setupDataChannel() {
//     dataChannel.onopen = () => {
//         statusDiv.innerText = "P2P connecté ✔";
//     };

//     dataChannel.onmessage = (event) => {
//         log("👤 Ami: " + event.data);
//     };
// }

// async function makeOffer() {
//     const offer = await pc.createOffer();
//     await pc.setLocalDescription(offer);
//     socket.send(JSON.stringify({ offer }));
// }

// // Bouton envoyer
// document.getElementById("send").onclick = () => {
//     console.log("Envoi du message...");
//     const msg = document.getElementById("msg").value;
//     dataChannel.send(msg);
//     log("Moi: " + msg);
//     document.getElementById("msg").value = "";
// };



// script.js - version corrigée et plus robuste

let pc;
let dataChannel;
let socket;
let decidedRole = false;   // indique si on a choisi offerer/non-offerer
let isOfferer = false;
let sendQueue = [];        // file d'attente si envoi avant ouverture

const statusDiv = document.getElementById("status");
const chatDiv = document.getElementById("chat");
const startBtn = document.getElementById("start");
const sendBtn = document.getElementById("send");
const msgInput = document.getElementById("msg");

// Désactiver envoi tant que pas prêt
sendBtn.disabled = true;

function log(msg) {
  chatDiv.innerHTML += `<div>${msg}</div>`;
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

startBtn.onclick = () => start();

async function start() {
  statusDiv.innerText = "Connexion en cours...";
  startBtn.disabled = true;

  // init PeerConnection
  initPeer();

  // Connexion WebSocket
  socket = new WebSocket("ws://localhost:8080"); // adapte si distant

  socket.onopen = () => {
    statusDiv.innerText = "Connecté au serveur de signalisation";
    // Annoncer notre présence pour élire un offerer
    socket.send(JSON.stringify({ type: "join" }));

    // Si personne ne nous envoie de "join" dans 600ms, on devient offerer automatiquement
    setTimeout(() => {
      if (!decidedRole) {
        isOfferer = true;
        decidedRole = true;
        log("Rôle: offerer (fallback)");
        makeOffer(); // lancer l'offre
      }
    }, 600);
  };

  socket.onmessage = async (evt) => {
    // gérer Blob ou string
    let text;
    if (evt.data instanceof Blob) {
      text = await evt.data.text();
    } else {
      text = evt.data;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Message non-JSON reçu:", text);
      return;
    }

    // Gestion des messages de signalisation
    if (data.type === "join") {
      // Un autre client a rejoint : si on n'a pas décidé, on devient NON-offerer (attente)
      if (!decidedRole) {
        isOfferer = false;
        decidedRole = true;
        log("Un pair a annoncé sa présence → je suis non-offerer (j'attends l'offre)");
      }
      return;
    }

    if (data.offer) {
      // On reçoit une offer
      log("Offer reçue — création d'une answer...");
      await pc.setRemoteDescription(data.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.send(JSON.stringify({ answer }));
      return;
    }

    if (data.answer) {
      log("Answer reçue");
      await pc.setRemoteDescription(data.answer);
      return;
    }

    if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        console.error("Erreur addIceCandidate:", err);
      }
      return;
    }
  };

  socket.onclose = () => {
    statusDiv.innerText = "Signalisation déconnectée";
  };

  socket.onerror = (e) => {
    console.error("WebSocket erreur", e);
    statusDiv.innerText = "Erreur signalisation";
  };
}

function initPeer() {
  pc = new RTCPeerConnection();

  pc.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("PC state:", pc.connectionState);
    statusDiv.innerText = `PC: ${pc.connectionState}`;
  };

  // Si on est offerer, on créera le dataChannel
  // (mais ici on ne sait pas encore si on est offerer au moment d'initPeer)
  // on attend l'événement ou la création manuelle :

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    log("🔗 DataChannel ouvert — prêt à envoyer");
    sendBtn.disabled = false;
    statusDiv.innerText = "P2P connecté ✔";

    // envoyer ce qui est en file d'attente
    while (sendQueue.length) {
      const m = sendQueue.shift();
      safeSend(m);
    }
  };

  dataChannel.onmessage = (event) => {
    log("👤 Ami: " + event.data);
  };

  dataChannel.onclose = () => {
    log("🔌 DataChannel fermé");
    sendBtn.disabled = true;
  };

  dataChannel.onerror = (e) => {
    console.error("DataChannel erreur:", e);
  };
}

async function makeOffer() {
  // Si nous ne sommes pas encore offerer officialisé, on le devient
  if (!decidedRole) {
    isOfferer = true;
    decidedRole = true;
  } else if (!isOfferer) {
    // si on a déjà décidé d'être non-offerer, ne pas créer d'offer
    return;
  }

  // créer le canal si on est offerer
  dataChannel = pc.createDataChannel("chat");
  setupDataChannel();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ offer }));
    log("Offer envoyée");
  } else {
    console.warn("Socket non prêt au moment de l'envoi de l'offer");
  }
}

// Envoi sécurisé : si dataChannel non prêt, on met en queue
function safeSend(text) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(text);
    log("Moi: " + text);
  } else {
    // on stocke pour envoi ultérieur
    sendQueue.push(text);
    log("En attente (file) : " + text);
  }
}

// Bouton envoyer
sendBtn.onclick = () => {
  const msg = msgInput.value.trim();
  if (!msg) return;
  safeSend(msg);
  msgInput.value = "";
};

