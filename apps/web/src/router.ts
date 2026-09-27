import { createRouter, createWebHistory } from "vue-router";
import { setUnauthenticatedHandler } from "./api";
import { clearUser, loadSession, session } from "./session";
import { loadSystem } from "./system";
import AccountsView from "./views/AccountsView.vue";
import AccountView from "./views/AccountView.vue";
import ChallengeView from "./views/ChallengeView.vue";
import InstanceView from "./views/InstanceView.vue";
import LoginView from "./views/LoginView.vue";
import OverviewView from "./views/OverviewView.vue";
import SetupView from "./views/SetupView.vue";

// History base from <base href>, so deep links work under any BASE_PATH.
export const router = createRouter({
  history: createWebHistory(new URL(document.baseURI).pathname),
  routes: [
    { path: "/", name: "overview", component: OverviewView },
    { path: "/account", name: "account", component: AccountView },
    { path: "/accounts", name: "accounts", component: AccountsView },
    { path: "/instances/:ref", name: "instance", component: InstanceView },
    { path: "/accounts/:number/challenge", name: "challenge", component: ChallengeView },
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
    { path: "/setup", name: "setup", component: SetupView, meta: { public: true } },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  let info = session.value;
  if (!info) {
    try {
      info = await loadSession();
    } catch {
      // Server not reachable: let the page render and show its own error.
      return true;
    }
  }
  if (info.setupRequired) return to.name === "setup" ? true : { name: "setup" };
  if (!info.user) {
    if (to.name === "login") return true;
    return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
  }
  if (to.meta["public"]) return { name: "overview" };
  void loadSystem();
  return true;
});

setUnauthenticatedHandler(() => {
  clearUser();
  if (!router.currentRoute.value.meta["public"]) void router.push({ name: "login" });
});
