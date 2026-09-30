import { createRouter, createWebHistory } from "vue-router";
import { setUnauthenticatedHandler } from "./api";
import { clearUser, loadSession, session } from "./session";
import { loadSystem } from "./system";
import AccountsView from "./views/AccountsView.vue";
import AlgosView from "./views/AlgosView.vue";
import AccountView from "./views/AccountView.vue";
import InstanceFormView from "./views/InstanceFormView.vue";
import InstanceView from "./views/InstanceView.vue";
import LoginView from "./views/LoginView.vue";
import OverviewView from "./views/OverviewView.vue";
import ProfileView from "./views/ProfileView.vue";
import SetupView from "./views/SetupView.vue";

// History base from <base href>, so deep links work under any BASE_PATH.
export const router = createRouter({
  history: createWebHistory(new URL(document.baseURI).pathname),
  routes: [
    { path: "/", name: "overview", component: OverviewView },
    { path: "/profile", name: "profile", component: ProfileView },
    { path: "/account", redirect: "/profile" },
    { path: "/accounts", name: "accounts", component: AccountsView },
    { path: "/algos", name: "algos", component: AlgosView },
    { path: "/instances/new", name: "instance-new", component: InstanceFormView },
    { path: "/instances/:ref", name: "instance", component: InstanceView },
    // Tabs of the instance page; the same component, so switching keeps its state.
    { path: "/instances/:ref/config", name: "instance-config", component: InstanceView },
    { path: "/instances/:ref/edit", name: "instance-edit", component: InstanceFormView },
    { path: "/accounts/:number", name: "account", component: AccountView },
    // The challenge profile is edited in a modal on the account page now.
    {
      path: "/accounts/:number/challenge",
      redirect: (to) => ({ name: "account", params: to.params, query: { challenge: "edit" } }),
    },
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
