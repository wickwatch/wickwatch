import { createRouter, createWebHistory } from "vue-router";
import OverviewView from "./views/OverviewView.vue";

// History base from <base href>, so deep links work under any BASE_PATH.
export const router = createRouter({
  history: createWebHistory(new URL(document.baseURI).pathname),
  routes: [{ path: "/", name: "overview", component: OverviewView }],
});
