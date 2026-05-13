import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { SearchSort, searchListings } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import type { MarketListing } from "@/lib/types";

export const runtime = "nodejs";

function parseFlag(value: string | null) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeSearchTerm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

function normalizeSort(value: string): SearchSort {
  if (value === "price_asc" || value === "price_desc" || value === "newest") {
    return value;
  }
  return "relevance";
}

function normalizePage(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

function normalizePageSize(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 15;
  }
  return Math.min(60, Math.max(1, Math.floor(numeric)));
}

function normalizePrice(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

const MULTI_VALUE_FILTER_KEYS = new Set([
  "fortnite_outfits",
  "fortnite_pickaxes",
  "fortnite_emotes",
  "fortnite_gliders"
]);

const FORTNITE_SELECTOR_FILTER_KEYS = [
  "fortnite_outfits",
  "fortnite_pickaxes",
  "fortnite_emotes",
  "fortnite_gliders"
] as const;
const FILTER_BACKFILL_MAX_PAGES = 4;

function sanitizeSupplierFilterValue(key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (MULTI_VALUE_FILTER_KEYS.has(key)) {
    const values = trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const entry of values) {
      const normalized = clampText(entry, 80);
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      unique.push(normalized);
      if (unique.length >= 30) {
        break;
      }
    }
    return unique.join(",");
  }

  return clampText(trimmed, 120);
}

async function trackSearchTerm(rawQuery: string, page: number) {
  if (page !== 1) {
    return;
  }
  const term = normalizeSearchTerm(rawQuery);
  if (term.length < 2 || term.length > 80) {
    return;
  }
  await updateStore((store) => {
    const nowIso = new Date().toISOString();
    const existing = store.searchStats.find((entry) => entry.term === term);
    if (!existing) {
      store.searchStats.push({
        term,
        count: 1,
        lastSearchedAt: nowIso
      });
    } else {
      const lastAt = Date.parse(existing.lastSearchedAt);
      const canIncrement = Number.isNaN(lastAt) || Date.now() - lastAt >= 15_000;
      if (!canIncrement) {
        return;
      }
      existing.count += 1;
      existing.lastSearchedAt = nowIso;
    }

    store.searchStats.sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return Date.parse(right.lastSearchedAt) - Date.parse(left.lastSearchedAt);
    });
    if (store.searchStats.length > 2000) {
      store.searchStats = store.searchStats.slice(0, 2000);
    }
  });
}

const SUPPLIER_FILTER_KEYS = [
  "ma",
  "online",
  "vac",
  "first_owner",
  "fortnite_skin_count_min",
  "fortnite_skin_count_max",
  "fortnite_level_min",
  "fortnite_level_max",
  "fortnite_lifetime_wins_min",
  "fortnite_lifetime_wins_max",
  "fortnite_account_origin",
  "fortnite_exclude_account_origin",
  "fortnite_account_login",
  "fortnite_email_domain",
  "fortnite_exclude_mail_domain",
  "fortnite_mail_provider",
  "fortnite_exclude_mail_provider",
  "fortnite_not_sold_before",
  "fortnite_sold_before",
  "fortnite_not_sold_before_by_me",
  "fortnite_sold_before_by_me",
  "fortnite_rocket_league_purchases",
  "fortnite_guarantee_length",
  "fortnite_last_activity_days_max",
  "fortnite_changeable_email",
  "fortnite_xbox_linkable",
  "fortnite_psn_linkable",
  "fortnite_outfits",
  "fortnite_pickaxes",
  "fortnite_emotes",
  "fortnite_gliders",
  "fortnite_pickaxe_count_min",
  "fortnite_pickaxe_count_max",
  "fortnite_emote_count_min",
  "fortnite_emote_count_max",
  "fortnite_glider_count_min",
  "fortnite_glider_count_max",
  "fortnite_vbucks_min",
  "fortnite_vbucks_max",
  "fortnite_vbucks_cost_outfits_min",
  "fortnite_vbucks_cost_outfits_max",
  "fortnite_vbucks_cost_pickaxes_min",
  "fortnite_vbucks_cost_pickaxes_max",
  "fortnite_vbucks_cost_emotes_min",
  "fortnite_vbucks_cost_emotes_max",
  "fortnite_vbucks_cost_gliders_min",
  "fortnite_vbucks_cost_gliders_max",
  "fortnite_refund_credits_min",
  "fortnite_refund_credits_max",
  "fortnite_stw_edition",
  "fortnite_exclude_stw_edition",
  "fortnite_paid_skin_count_min",
  "fortnite_paid_skin_count_max",
  "fortnite_paid_pickaxe_count_min",
  "fortnite_paid_pickaxe_count_max",
  "fortnite_paid_emote_count_min",
  "fortnite_paid_emote_count_max",
  "fortnite_paid_glider_count_min",
  "fortnite_paid_glider_count_max",
  "fortnite_battle_pass",
  "fortnite_battle_pass_level_min",
  "fortnite_battle_pass_level_max",
  "fortnite_last_transaction_years_min",
  "fortnite_no_transactions",
  "fortnite_registered_years_min",
  "fortnite_country",
  "fortnite_exclude_country",
  "riot_account_origin",
  "riot_exclude_account_origin",
  "riot_country",
  "riot_exclude_country",
  "riot_last_activity_days_max",
  "riot_email_linked",
  "riot_phone_linked",
  "riot_email_domain",
  "riot_exclude_mail_domain",
  "riot_mail_provider",
  "riot_exclude_mail_provider",
  "riot_not_sold_before",
  "riot_sold_before",
  "riot_not_sold_before_by_me",
  "riot_sold_before_by_me",
  "valorant_rank",
  "valorant_rank_min",
  "valorant_rank_max",
  "valorant_previous_rank_min",
  "valorant_previous_rank_max",
  "valorant_last_rank_min",
  "valorant_last_rank_max",
  "valorant_skin_count_min",
  "valorant_skin_count_max",
  "valorant_has_knife",
  "valorant_knife_count_min",
  "valorant_knife_count_max",
  "valorant_gunbuddies_count_min",
  "valorant_gunbuddies_count_max",
  "valorant_agents_count_min",
  "valorant_agents_count_max",
  "valorant_region",
  "valorant_exclude_region",
  "valorant_level_min",
  "valorant_level_max",
  "valorant_vp_min",
  "valorant_vp_max",
  "valorant_inventory_value_min",
  "valorant_inventory_value_max",
  "valorant_rp_min",
  "valorant_rp_max",
  "valorant_free_agents_min",
  "valorant_free_agents_max",
  "lol_skin_count_min",
  "lol_skin_count_max",
  "lol_champions_count_min",
  "lol_champions_count_max",
  "lol_region",
  "lol_exclude_region",
  "lol_rank",
  "lol_level_min",
  "lol_level_max",
  "lol_winrate_min",
  "lol_winrate_max",
  "lol_blue_essence_min",
  "lol_blue_essence_max",
  "lol_orange_essence_min",
  "lol_orange_essence_max",
  "lol_mythic_essence_min",
  "lol_mythic_essence_max",
  "lol_riot_points_min",
  "lol_riot_points_max",
  "siege_account_origin",
  "siege_exclude_account_origin",
  "siege_country",
  "siege_exclude_country",
  "siege_last_activity_days_max",
  "siege_email_domain",
  "siege_exclude_mail_domain",
  "siege_mail_provider",
  "siege_exclude_mail_provider",
  "siege_not_sold_before",
  "siege_sold_before",
  "siege_not_sold_before_by_me",
  "siege_sold_before_by_me",
  "siege_platform",
  "siege_rank",
  "siege_region",
  "siege_exclude_region",
  "siege_level_min",
  "siege_level_max",
  "siege_operators_min",
  "siege_operators_max",
  "siege_skins_min",
  "siege_skins_max",
  "siege_credits_min",
  "siege_credits_max",
  "siege_kd_min",
  "siege_kd_max",
  "siege_winrate_min",
  "siege_winrate_max",
  "siege_operators",
  "siege_skins",
  "siege_rank_min",
  "siege_rank_max",
  "siege_banned",
  "supercell_account_origin",
  "supercell_exclude_account_origin",
  "supercell_country",
  "supercell_exclude_country",
  "supercell_last_activity_days_max",
  "supercell_email_domain",
  "supercell_exclude_mail_domain",
  "supercell_mail_provider",
  "supercell_exclude_mail_provider",
  "supercell_not_sold_before",
  "supercell_sold_before",
  "supercell_not_sold_before_by_me",
  "supercell_sold_before_by_me",
  "supercell_game",
  "supercell_exclude_game",
  "supercell_trophies_min",
  "supercell_trophies_max",
  "supercell_gems_min",
  "supercell_gems_max",
  "supercell_level_min",
  "supercell_level_max",
  "supercell_brawl_brawlers_min",
  "supercell_brawl_brawlers_max",
  "supercell_brawl_skins_min",
  "supercell_brawl_skins_max",
  "supercell_brawl_wins_min",
  "supercell_brawl_wins_max",
  "supercell_brawl_legendary_brawlers_min",
  "supercell_brawl_legendary_brawlers_max",
  "supercell_brawl_hypercharges_min",
  "supercell_brawl_hypercharges_max",
  "supercell_brawl_highest_trophies_min",
  "supercell_brawl_highest_trophies_max",
  "supercell_brawl_pass",
  "supercell_cr_crown_level_min",
  "supercell_cr_crown_level_max",
  "supercell_cr_evolved_cards_min",
  "supercell_cr_evolved_cards_max",
  "supercell_cr_champions_min",
  "supercell_cr_champions_max",
  "supercell_cr_league_trophies_min",
  "supercell_cr_league_trophies_max",
  "supercell_cr_league_number_min",
  "supercell_cr_league_number_max",
  "supercell_cr_royale_pass",
  "supercell_coc_cup_count_min",
  "supercell_coc_cup_count_max",
  "supercell_coc_wins_min",
  "supercell_coc_wins_max",
  "supercell_coc_town_hall_min",
  "supercell_coc_town_hall_max",
  "supercell_coc_total_hero_level_min",
  "supercell_coc_total_hero_level_max",
  "supercell_coc_total_troops_level_min",
  "supercell_coc_total_troops_level_max",
  "supercell_coc_total_spell_level_min",
  "supercell_coc_total_spell_level_max",
  "supercell_coc_total_heroes_builder_min",
  "supercell_coc_total_heroes_builder_max",
  "supercell_coc_total_troops_builder_min",
  "supercell_coc_total_troops_builder_max",
  "supercell_coc_builder_hall_cups_min",
  "supercell_coc_builder_hall_cups_max",
  "supercell_coc_builder_hall_min",
  "supercell_coc_builder_hall_max",
  "supercell_coc_gold_pass",
  "roblox_account_origin",
  "roblox_exclude_account_origin",
  "roblox_country",
  "roblox_exclude_country",
  "roblox_email_domain",
  "roblox_exclude_mail_domain",
  "roblox_mail_provider",
  "roblox_exclude_mail_provider",
  "roblox_last_activity_days_max",
  "roblox_not_sold_before",
  "roblox_sold_before",
  "roblox_not_sold_before_by_me",
  "roblox_sold_before_by_me",
  "roblox_level_min",
  "roblox_level_max",
  "roblox_robux_min",
  "roblox_robux_max",
  "roblox_friends_min",
  "roblox_friends_max",
  "roblox_followers_min",
  "roblox_followers_max",
  "roblox_registered_earlier",
  "roblox_registered_unit",
  "roblox_subscription_type",
  "roblox_validity_for",
  "roblox_validity_unit",
  "roblox_transaction_robux_min",
  "roblox_transaction_robux_max",
  "roblox_gamepasses_min",
  "roblox_gamepasses_max",
  "roblox_inventory_value_min",
  "roblox_inventory_value_max",
  "roblox_limited_rap_min",
  "roblox_limited_rap_max",
  "roblox_ugc_rap_min",
  "roblox_ugc_rap_max",
  "roblox_offsale_items_min",
  "roblox_offsale_items_max",
  "roblox_credit_balance_min",
  "roblox_credit_balance_max",
  "roblox_age_days_min",
  "roblox_age_days_max",
  "roblox_age_group",
  "roblox_exclude_age_group",
  "roblox_email_verified",
  "roblox_xbox_connected",
  "roblox_psn_connected",
  "roblox_only_verified",
  "roblox_age_verified",
  "roblox_auto_renewal_subscription",
  "roblox_donation_popular_games",
  "roblox_voice_chat",
  "roblox_selected_game",
  "media_account_origin",
  "media_exclude_account_origin",
  "media_country",
  "media_exclude_country",
  "media_last_activity_days_max",
  "media_email_domain",
  "media_exclude_mail_domain",
  "media_mail_provider",
  "media_exclude_mail_provider",
  "media_not_sold_before",
  "media_sold_before",
  "media_not_sold_before_by_me",
  "media_sold_before_by_me",
  "media_platform",
  "media_followers_min",
  "media_followers_max",
  "media_following_min",
  "media_following_max",
  "media_posts_min",
  "media_posts_max",
  "media_age_days_min",
  "media_age_days_max",
  "media_engagement_min",
  "media_engagement_max",
  "media_account_type",
  "media_verified",
  "telegram_account_origin",
  "telegram_exclude_account_origin",
  "telegram_country",
  "telegram_exclude_country",
  "telegram_last_activity_days_max",
  "telegram_email_domain",
  "telegram_exclude_mail_domain",
  "telegram_mail_provider",
  "telegram_exclude_mail_provider",
  "telegram_not_sold_before",
  "telegram_sold_before",
  "telegram_not_sold_before_by_me",
  "telegram_sold_before_by_me",
  "telegram_premium",
  "telegram_dialogs_min",
  "telegram_dialogs_max",
  "telegram_channels_min",
  "telegram_channels_max",
  "telegram_groups_min",
  "telegram_groups_max",
  "telegram_sessions_min",
  "telegram_sessions_max",
  "telegram_stars_min",
  "telegram_stars_max",
  "telegram_age_days_min",
  "telegram_age_days_max",
  "discord_account_origin",
  "discord_exclude_account_origin",
  "discord_country",
  "discord_exclude_country",
  "discord_last_activity_days_max",
  "discord_email_domain",
  "discord_exclude_mail_domain",
  "discord_mail_provider",
  "discord_exclude_mail_provider",
  "discord_not_sold_before",
  "discord_sold_before",
  "discord_not_sold_before_by_me",
  "discord_sold_before_by_me",
  "discord_nitro",
  "discord_friends_min",
  "discord_friends_max",
  "discord_servers_min",
  "discord_servers_max",
  "discord_age_days_min",
  "discord_age_days_max",
  "discord_phone_verified",
  "discord_email_verified",
  "discord_badges_min",
  "discord_badges_max",
  "steam_account_origin",
  "steam_exclude_account_origin",
  "steam_country",
  "steam_exclude_country",
  "steam_last_activity_days_max",
  "steam_email_domain",
  "steam_exclude_mail_domain",
  "steam_mail_provider",
  "steam_exclude_mail_provider",
  "steam_not_sold_before",
  "steam_sold_before",
  "steam_not_sold_before_by_me",
  "steam_sold_before_by_me",
  "steam_game_count_min",
  "steam_game_count_max",
  "steam_level_min",
  "steam_level_max",
  "steam_inventory_value_min",
  "steam_inventory_value_max",
  "steam_hours_min",
  "steam_hours_max",
  "steam_rank",
  "steam_region",
  "steam_exclude_region",
  "steam_vac",
  "cs2_account_origin",
  "cs2_exclude_account_origin",
  "cs2_country",
  "cs2_exclude_country",
  "cs2_last_activity_days_max",
  "cs2_email_domain",
  "cs2_exclude_mail_domain",
  "cs2_mail_provider",
  "cs2_exclude_mail_provider",
  "cs2_not_sold_before",
  "cs2_sold_before",
  "cs2_not_sold_before_by_me",
  "cs2_sold_before_by_me",
  "cs2_prime",
  "cs2_rank",
  "cs2_faceit_level_min",
  "cs2_faceit_level_max",
  "cs2_premier_rating_min",
  "cs2_premier_rating_max",
  "cs2_wins_min",
  "cs2_wins_max",
  "cs2_hours_min",
  "cs2_hours_max",
  "cs2_inventory_value_min",
  "cs2_inventory_value_max",
  "cs2_vac",
  "battlenet_account_origin",
  "battlenet_exclude_account_origin",
  "battlenet_country",
  "battlenet_exclude_country",
  "battlenet_last_activity_days_max",
  "battlenet_email_domain",
  "battlenet_exclude_mail_domain",
  "battlenet_mail_provider",
  "battlenet_exclude_mail_provider",
  "battlenet_not_sold_before",
  "battlenet_sold_before",
  "battlenet_not_sold_before_by_me",
  "battlenet_sold_before_by_me",
  "battlenet_region",
  "battlenet_exclude_region",
  "battlenet_level_min",
  "battlenet_level_max",
  "battlenet_games_min",
  "battlenet_games_max",
  "battlenet_rank",
  "battlenet_cod_cp_min",
  "battlenet_cod_cp_max",
  "battlenet_wow_ilvl_min",
  "battlenet_wow_ilvl_max"
] as const;

type ParsedSearchRequest = {
  inputQuery: string;
  query: string;
  usedScopeFallbackQuery: boolean;
  sort: SearchSort;
  page: number;
  pageSize: number;
  minPrice: number | null;
  maxPrice: number | null;
  game: string;
  category: string;
  hasImage: boolean;
  hasDescription: boolean;
  hasSpecs: boolean;
  supplierFilters: Record<string, string>;
};

function resolveScopeFallbackQuery(game: string, category: string) {
  const normalized = `${game} ${category}`.toLowerCase();
  if (normalized.includes("fortnite")) {
    return "fortnite";
  }
  if (normalized.includes("valorant") || normalized.includes("riot")) {
    return "valorant";
  }
  if (normalized.includes("siege") || normalized.includes("rainbow")) {
    return "siege";
  }
  if (normalized.includes("uplay") || normalized.includes("ubisoft") || normalized.includes("r6")) {
    return "siege";
  }
  if (normalized.includes("roblox") || normalized.includes("robux") || normalized.includes("rbx")) {
    return "roblox";
  }
  if (normalized.includes("supercell")) {
    return "supercell";
  }
  if (normalized.includes("steam")) {
    return "steam";
  }
  if (normalized.includes("cs2") || normalized.includes("counter")) {
    return "cs2";
  }
  if (normalized.includes("battlenet") || normalized.includes("battle.net")) {
    return "battlenet";
  }
  if (normalized.includes("telegram")) {
    return "telegram";
  }
  if (normalized.includes("discord")) {
    return "discord";
  }
  if (normalized.includes("media") || normalized.includes("social")) {
    return "social";
  }
  return "";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFortniteSkinCount(listing: MarketListing) {
  const parseCount = (value: string) => {
    const numeric = Number(value.replace(/[^\d]/g, ""));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  };

  for (const spec of listing.specs) {
    const label = normalizeText(spec.label);
    const hasSkinCountLabel =
      label.includes("fortnite skin count") ||
      label.includes("skin count") ||
      label.includes("skins count") ||
      label.includes("outfit count") ||
      label.includes("outfits count") ||
      label.includes("count skins") ||
      label.includes("count outfits");
    if (hasSkinCountLabel) {
      const value = parseCount(String(spec.value));
      if (value != null) {
        return value;
      }
    }
  }

  const titleMatch = listing.title.match(/\b(\d{1,5})\s+skins?\b/i);
  if (titleMatch) {
    const value = parseCount(titleMatch[1] ?? "");
    if (value != null) {
      return value;
    }
  }

  const descriptionMatch = listing.description.match(
    /\b(?:skins?|skin count|outfits?|outfit count)\s*[:=-]?\s*(\d{1,5})\b/i
  );
  if (descriptionMatch) {
    const value = parseCount(descriptionMatch[1] ?? "");
    if (value != null) {
      return value;
    }
  }
  return null;
}

function applyHardFortniteFilters(
  listings: MarketListing[],
  supplierFilters: Record<string, string>
) {
  const minSkins = Number(supplierFilters.fortnite_skin_count_min ?? NaN);
  const maxSkins = Number(supplierFilters.fortnite_skin_count_max ?? NaN);
  const hasMin = Number.isFinite(minSkins) && minSkins > 0;
  const hasMax = Number.isFinite(maxSkins) && maxSkins > 0;
  let filtered = listings.slice();
  if (hasMin || hasMax) {
    filtered = filtered.filter((listing) => {
      const count = parseFortniteSkinCount(listing);
      // Keep listing when count is not parseable at this API layer.
      // Provider-side deep filtering still applies stricter checks later.
      if (count == null) {
        return true;
      }
      if (hasMin && count < minSkins) {
        return false;
      }
      if (hasMax && count > maxSkins) {
        return false;
      }
      return true;
    });
  }

  return filtered;
}

function isRobloxScopedRequest(game: string, category: string) {
  const normalized = normalizeText(`${game} ${category}`);
  return normalized.includes("roblox");
}

function applyHardRobloxScopeFilters(listings: MarketListing[]) {
  const strongRobloxSignals = ["roblox", "rbx", "robux", "headless", "korblox", "limited"];
  const wrongVerticalSignals = ["telegram", "discord", "instagram", "tiktok"];
  const phoneSimSignals = ["phys sim", "physical sim", "sim card", "phone number"];

  const looksLikePhoneSimListing = (title: string, scope: string) => {
    const normalizedTitle = normalizeText(title);
    return (
      /^\+\d/.test(title.trim()) ||
      phoneSimSignals.some((token) => scope.includes(token)) ||
      (normalizedTitle.includes("sim") && !strongRobloxSignals.some((token) => scope.includes(token)))
    );
  };

  return listings.filter((listing) => {
    // Keep this scope guard conservative: only inspect top-level fields.
    // Roblox listings often mention other platforms inside details/specs.
    const scope = normalizeText(`${listing.game} ${listing.category} ${listing.title}`);
    const hasRobloxSignal = strongRobloxSignals.some((token) => scope.includes(token));
    const hasWrongVerticalSignal = wrongVerticalSignals.some((token) => scope.includes(token));

    if (hasWrongVerticalSignal && !hasRobloxSignal) {
      return false;
    }
    if (looksLikePhoneSimListing(listing.title, scope)) {
      return false;
    }
    return true;
  });
}

function getFirstFortniteSelectorTerm(supplierFilters: Record<string, string>) {
  for (const key of FORTNITE_SELECTOR_FILTER_KEYS) {
    const firstTerm = supplierFilters[key]?.split(",")[0]?.trim() ?? "";
    if (firstTerm) {
      return firstTerm;
    }
  }
  return "";
}

function getFortniteSelectorMeta(supplierFilters: Record<string, string>) {
  let activeKeys = 0;
  let totalTerms = 0;
  for (const key of FORTNITE_SELECTOR_FILTER_KEYS) {
    const terms = (supplierFilters[key] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (terms.length > 0) {
      activeKeys += 1;
      totalTerms += terms.length;
    }
  }
  return {
    activeKeys,
    totalTerms,
    firstTerm: getFirstFortniteSelectorTerm(supplierFilters)
  };
}

function hasActiveFortniteSelectorFilters(supplierFilters: Record<string, string>) {
  return FORTNITE_SELECTOR_FILTER_KEYS.some((key) => {
    const value = supplierFilters[key]?.trim() ?? "";
    return value.length > 0;
  });
}

function mergeUniqueListings(target: MarketListing[], incoming: MarketListing[], limit: number) {
  const seen = new Set(target.map((entry) => entry.id.trim().toLowerCase()));
  for (const listing of incoming) {
    const signature = listing.id.trim().toLowerCase();
    if (!signature || seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    target.push(listing);
    if (target.length >= limit) {
      break;
    }
  }
}

function applyImplicitQueryFallbacks(input: {
  query: string;
  game: string;
  category: string;
  supplierFilters: Record<string, string>;
}) {
  return {
    query: input.query,
    usedScopeFallbackQuery: false
  };
}

function applyHardPriceFilters(
  listings: MarketListing[],
  minPrice: number | null,
  maxPrice: number | null
) {
  const hasMin = Number.isFinite(minPrice ?? NaN);
  const hasMax = Number.isFinite(maxPrice ?? NaN);
  if (!hasMin && !hasMax) {
    return listings;
  }
  let effectiveMin = hasMin ? Number(minPrice) : null;
  let effectiveMax = hasMax ? Number(maxPrice) : null;
  if (
    effectiveMin != null &&
    effectiveMax != null &&
    Number.isFinite(effectiveMin) &&
    Number.isFinite(effectiveMax) &&
    effectiveMin > effectiveMax
  ) {
    const swap = effectiveMin;
    effectiveMin = effectiveMax;
    effectiveMax = swap;
  }

  return listings.filter((listing) => {
    const price = Number(listing.price);
    if (!Number.isFinite(price)) {
      return false;
    }
    if (effectiveMin != null && price < effectiveMin) {
      return false;
    }
    if (effectiveMax != null && price > effectiveMax) {
      return false;
    }
    return true;
  });
}

function parseSearchRequestFromParams(params: URLSearchParams): ParsedSearchRequest {
  const inputQuery = clampText(params.get("q")?.trim() ?? "", 180);
  let query = inputQuery;
  const sort = normalizeSort((params.get("sort") ?? "").trim());
  const page = normalizePage(params.get("page"));
  const pageSize = normalizePageSize(params.get("pageSize"));
  const minPrice = normalizePrice(params.get("minPrice"));
  const maxPrice = normalizePrice(params.get("maxPrice"));
  const game = clampText(params.get("game")?.trim() ?? "", 80);
  const category = clampText(params.get("category")?.trim() ?? "", 80);
  const hasImage = parseFlag(params.get("hasImage"));
  const hasDescription = parseFlag(params.get("hasDescription"));
  const hasSpecs = parseFlag(params.get("hasSpecs"));

  const supplierFilters: Record<string, string> = {};
  for (const key of SUPPLIER_FILTER_KEYS) {
    const value = sanitizeSupplierFilterValue(key, params.get(key)?.trim() ?? "");
    if (value) {
      supplierFilters[key] = value;
    }
  }
  const implicitFallback = applyImplicitQueryFallbacks({
    query,
    game,
    category,
    supplierFilters
  });
  query = implicitFallback.query;
  const usedScopeFallbackQuery = implicitFallback.usedScopeFallbackQuery;

  return {
    inputQuery,
    query,
    usedScopeFallbackQuery,
    sort,
    page,
    pageSize,
    minPrice,
    maxPrice,
    game,
    category,
    hasImage,
    hasDescription,
    hasSpecs,
    supplierFilters
  };
}

function parseSearchRequestFromBody(rawBody: unknown): ParsedSearchRequest {
  const payload =
    rawBody && typeof rawBody === "object"
      ? (rawBody as Record<string, unknown>)
      : {};
  const inputQuery = clampText(String(payload.q ?? "").trim(), 180);
  let query = inputQuery;
  const sort = normalizeSort(String(payload.sort ?? "").trim());
  const page = normalizePage(payload.page);
  const pageSize = normalizePageSize(payload.pageSize);
  const minPrice = normalizePrice(payload.minPrice);
  const maxPrice = normalizePrice(payload.maxPrice);
  const game = clampText(String(payload.game ?? "").trim(), 80);
  const category = clampText(String(payload.category ?? "").trim(), 80);
  const hasImage = parseFlag(String(payload.hasImage ?? ""));
  const hasDescription = parseFlag(String(payload.hasDescription ?? ""));
  const hasSpecs = parseFlag(String(payload.hasSpecs ?? ""));

  const supplierFilters: Record<string, string> = {};
  const rawSupplierFilters =
    payload.supplierFilters && typeof payload.supplierFilters === "object"
      ? (payload.supplierFilters as Record<string, unknown>)
      : {};
  for (const key of SUPPLIER_FILTER_KEYS) {
    const value = sanitizeSupplierFilterValue(key, String(rawSupplierFilters[key] ?? ""));
    if (value) {
      supplierFilters[key] = value;
    }
  }
  const implicitFallback = applyImplicitQueryFallbacks({
    query,
    game,
    category,
    supplierFilters
  });
  query = implicitFallback.query;
  const usedScopeFallbackQuery = implicitFallback.usedScopeFallbackQuery;

  return {
    inputQuery,
    query,
    usedScopeFallbackQuery,
    sort,
    page,
    pageSize,
    minPrice,
    maxPrice,
    game,
    category,
    hasImage,
    hasDescription,
    hasSpecs,
    supplierFilters
  };
}

async function runSearchRequest(parsed: ParsedSearchRequest) {
  try {
    const buildPayload = (result: Awaited<ReturnType<typeof searchListings>>) => {
      const fortniteScoped = applyHardFortniteFilters(result.listings, parsed.supplierFilters);
      const listings = applyHardPriceFilters(
        fortniteScoped,
        parsed.minPrice,
        parsed.maxPrice
      );
      return {
        listings,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          hasMore: listings.length > 0 && result.hasMore
        }
      };
    };

    const result = await searchListings(parsed.query, {
      sort: parsed.sort,
      minPrice: parsed.minPrice,
      maxPrice: parsed.maxPrice,
      page: parsed.page,
      pageSize: parsed.pageSize,
      game: parsed.game || null,
      category: parsed.category || null,
      hasImage: parsed.hasImage,
      hasDescription: parsed.hasDescription,
      hasSpecs: parsed.hasSpecs,
      supplierFilters: parsed.supplierFilters
    });
    if (parsed.query) {
      void trackSearchTerm(parsed.query, parsed.page);
    }
    let payload = buildPayload(result);
    if (
      payload.listings.length === 0 &&
      parsed.usedScopeFallbackQuery &&
      !parsed.inputQuery.trim() &&
      !Number.isFinite(parsed.minPrice ?? NaN) &&
      !Number.isFinite(parsed.maxPrice ?? NaN)
    ) {
      const scopeOnlyResult = await searchListings("", {
        sort: parsed.sort,
        minPrice: parsed.minPrice,
        maxPrice: parsed.maxPrice,
        page: parsed.page,
        pageSize: parsed.pageSize,
        game: parsed.game || null,
        category: parsed.category || null,
        hasImage: parsed.hasImage,
        hasDescription: parsed.hasDescription,
        hasSpecs: parsed.hasSpecs,
        supplierFilters: parsed.supplierFilters
      });
      const scopeOnlyPayload = buildPayload(scopeOnlyResult);
      if (scopeOnlyPayload.listings.length > 0) {
        payload = scopeOnlyPayload;
      }
    }

    const selectorMeta = getFortniteSelectorMeta(parsed.supplierFilters);
    const shouldBackfillFilteredPages =
      parsed.page === 1 &&
      selectorMeta.totalTerms >= 2 &&
      payload.listings.length < parsed.pageSize &&
      result.hasMore;

    if (shouldBackfillFilteredPages) {
      const mergedListings = payload.listings.slice();
      let currentPage = result.page;
      let hasMore = result.hasMore;
      let inspectedPages = 0;

      while (
        mergedListings.length < parsed.pageSize &&
        hasMore &&
        inspectedPages < FILTER_BACKFILL_MAX_PAGES
      ) {
        inspectedPages += 1;
        currentPage += 1;
        const nextResult = await searchListings(parsed.query, {
          sort: parsed.sort,
          minPrice: parsed.minPrice,
          maxPrice: parsed.maxPrice,
          page: currentPage,
          pageSize: parsed.pageSize,
          game: parsed.game || null,
          category: parsed.category || null,
          hasImage: parsed.hasImage,
          hasDescription: parsed.hasDescription,
          hasSpecs: parsed.hasSpecs,
          supplierFilters: parsed.supplierFilters
        });
        const nextPayload = buildPayload(nextResult);
        mergeUniqueListings(mergedListings, nextPayload.listings, parsed.pageSize);
        hasMore = nextResult.hasMore;
      }

      payload = {
        listings: mergedListings,
        pagination: {
          page: parsed.page,
          pageSize: parsed.pageSize,
          hasMore
        }
      };
    }

    return ok(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEARCH_FAILED";
    if (message === "LZT_AUTH_MISSING") {
      return fail("Search provider is not configured", 503);
    }
    if (message === "LZT_AUTH_FAILED") {
      return fail("Search provider authorization failed", 401);
    }
    return fail("Search unavailable", 502);
  }
}

function checkSearchRateLimit(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "search"),
    maxRequests: 90,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = checkSearchRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  const parsed = parseSearchRequestFromParams(request.nextUrl.searchParams);
  return runSearchRequest(parsed);
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkSearchRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  try {
    const body = (await request.json()) as unknown;
    const parsed = parseSearchRequestFromBody(body);
    return runSearchRequest(parsed);
  } catch {
    return fail("Invalid search request", 400);
  }
}
