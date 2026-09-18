import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://jgapathoxwkojfecqbdi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uwfsQ-4Fod_rpoGlq6KbGg_VFj2TSGS";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const modal = document.getElementById("modal");
const box = document.getElementById("modalContent");

function openModal(type) {
  modal.style.display = "flex";
  if (type === "login") {
    box.innerHTML = `
      <h2>Welcome back</h2>
      <p class="note">Log in to your TRADNEX account.</p>
      <div class="field"><label>Email</label><input id="loginEmail" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Password</label><input id="loginPassword" type="password" placeholder="Your password"></div>
      <p id="authMessage" class="note"></p>
      <button class="primary full" id="loginBtn">Login</button>`;
    document.getElementById("loginBtn").onclick = login;
  } else {
    box.innerHTML = `
      <h2>Create your account</h2>
      <p class="note">Start free and upgrade when ready.</p>
      <div class="field"><label>Full name</label><input id="signupName" placeholder="Your name"></div>
      <div class="field"><label>Email</label><input id="signupEmail" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Password</label><input id="signupPassword" type="password" placeholder="At least 6 characters"></div>
      <p id="authMessage" class="note"></p>
      <button class="primary full" id="signupBtn">Create account</button>`;
    document.getElementById("signupBtn").onclick = signup;
  }
}

async function signup() {
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const message = document.getElementById("authMessage");
  const button = document.getElementById("signupBtn");

  if (!name || !email || password.length < 6) {
    message.textContent = "Enter your name, a valid email and a password of at least 6 characters.";
    return;
  }

  button.disabled = true;
  message.textContent = "Creating your account...";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } }
  });

  button.disabled = false;

  if (error) {
    message.textContent = error.message;
    return;
  }

  if (data.session) {
    message.textContent = "Account created. You are now logged in.";
    setTimeout(() => { closeModal(); updateAuthUI(data.session.user); }, 700);
  } else {
    message.textContent = "Account created. Check your email to confirm your account, then log in.";
  }
}

async function login() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const message = document.getElementById("authMessage");
  const button = document.getElementById("loginBtn");

  if (!email || !password) {
    message.textContent = "Enter your email and password.";
    return;
  }

  button.disabled = true;
  message.textContent = "Signing in...";

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  button.disabled = false;

  if (error) {
    message.textContent = error.message;
    return;
  }

  closeModal();
  updateAuthUI(data.user);
  alert("Welcome to TRADNEX, " + (data.user.user_metadata?.full_name || data.user.email) + "!");
}

async function logout() {
  await supabase.auth.signOut();
  updateAuthUI(null);
}

function updateAuthUI(user) {
  const buttons = document.querySelectorAll("header .nav > div");
  if (!buttons.length) return;
  const container = buttons[0];
  if (user) {
 container.innerHTML = `<button class="ghost" id="logoutBtn">Logout</button><button class="primary" onclick="window.location.href='dashboard.html'">Dashboard</button>`;
    document.getElementById("logoutBtn").onclick = logout;
  } else {
    container.innerHTML = `<button onclick="openModal('login')" class="ghost">Login</button><button onclick="openModal('signup')" class="primary">Get Started</button>`;
  }
}

async function loadCurrentUser() {
  const { data } = await supabase.auth.getUser();
  updateAuthUI(data.user || null);
}

async function checkout(plan) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    openModal("login");
    document.getElementById("authMessage").textContent = "Please log in before choosing a paid plan.";
    return;
  }
  modal.style.display = "flex";
  box.innerHTML = `<h2>${plan} plan</h2><p class="note">Payments will be connected next. Your account is ready for subscription activation.</p><button class="primary full" onclick="closeModal()">Close</button>`;
}

function closeModal() { modal.style.display = "none"; }
window.openModal = openModal;
window.closeModal = closeModal;
window.checkout = checkout;
window.onclick = e => { if (e.target === modal) closeModal(); };

supabase.auth.onAuthStateChange((_event, session) => updateAuthUI(session?.user || null));
loadCurrentUser();
