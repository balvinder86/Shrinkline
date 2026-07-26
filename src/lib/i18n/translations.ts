// Scope: shared app chrome only (sidebar nav, Topbar, profile menu) —
// not a full-portal translation. Individual page content (Home,
// Product Mix, Inventory, etc.) stays English for now; extending this
// dictionary to cover a page is real, separate follow-up work, not
// something this file silently claims to already do.

export type Language = "en" | "es";

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

// Plain `string` leaves (not literal types) — the en/es variants have
// different literal values, and inferring the dict type from one of
// them would make the other variant fail to structurally match it.
export type TranslationDict = {
  navSection: { overview: string; growth: string; operations: string };
  nav: {
    home: string;
    productMix: string;
    inventory: string;
    invoices: string;
    reviews: string;
    seo: string;
    marketing: string;
    loyalty: string;
    scheduling: string;
    laborCost: string;
    admin: string;
    settings: string;
  };
  sidebar: { tagline: string };
  topbar: { searchPlaceholder: string; noMatch: string };
  dateRange: {
    today: string;
    last7Days: string;
    last30Days: string;
    thisMonth: string;
    lastMonth: string;
    apply: string;
  };
  profile: { language: string; restaurant: string; logout: string };
};

export const translations: Record<Language, TranslationDict> = {
  en: {
    navSection: {
      overview: "Overview",
      growth: "Growth",
      operations: "Operations",
    },
    nav: {
      home: "Home",
      productMix: "Product Mix",
      inventory: "Inventory & Ordering",
      invoices: "Invoices",
      reviews: "Reviews",
      seo: "SEO",
      marketing: "Marketing",
      loyalty: "Loyalty",
      scheduling: "Scheduling",
      laborCost: "Labor Cost",
      admin: "Admin",
      settings: "Settings",
    },
    sidebar: {
      tagline: "Owner Dashboard",
    },
    topbar: {
      searchPlaceholder: "Search and press Enter to jump to a page…",
      noMatch: "No match",
    },
    dateRange: {
      today: "Today",
      last7Days: "Last 7 days",
      last30Days: "Last 30 days",
      thisMonth: "This month",
      lastMonth: "Last month",
      apply: "Apply",
    },
    profile: {
      language: "Language",
      restaurant: "Restaurant",
      logout: "Log out",
    },
  },
  es: {
    navSection: {
      overview: "Resumen",
      growth: "Crecimiento",
      operations: "Operaciones",
    },
    nav: {
      home: "Inicio",
      productMix: "Mezcla de productos",
      inventory: "Inventario y pedidos",
      invoices: "Facturas",
      reviews: "Reseñas",
      seo: "SEO",
      marketing: "Marketing",
      loyalty: "Lealtad",
      scheduling: "Horarios",
      laborCost: "Costo laboral",
      admin: "Administración",
      settings: "Configuración",
    },
    sidebar: {
      tagline: "Panel del propietario",
    },
    topbar: {
      searchPlaceholder: "Busca y presiona Enter para ir a una página…",
      noMatch: "Sin resultados",
    },
    dateRange: {
      today: "Hoy",
      last7Days: "Últimos 7 días",
      last30Days: "Últimos 30 días",
      thisMonth: "Este mes",
      lastMonth: "Mes pasado",
      apply: "Aplicar",
    },
    profile: {
      language: "Idioma",
      restaurant: "Restaurante",
      logout: "Cerrar sesión",
    },
  },
};
