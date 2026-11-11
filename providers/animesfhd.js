/**
 * AnimesFHD - Brazilian anime via its public JSON API.
 * Standalone generator-based provider, following AnimesDigital's Nuvio contract.
 */
"use strict";

var BASE_URL = "https://animesfhd.net";
// Same TMDB metadata key used by the existing AnimesDigital provider.
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

var __async = function (__this, __arguments, generator) {
  return new Promise(function (resolve, reject) {
    function step(method, value) {
      try {
        var next = generator[method](value);
        if (next.done) resolve(next.value);
        else Promise.resolve(next.value).then(
          function (result) { step("next", result); },
          function (error) { step("throw", error); }
        );
      } catch (error) { reject(error); }
    }
    generator = generator.apply(__this, __arguments);
    step("next");
  });
};

function headers() {
  return { "User-Agent": USER_AGENT, Referer: BASE_URL + "/" };
}

function fetchJson(url) {
  return __async(this, null, function* () {
    try {
      var response = yield fetch(url, {
        method: "GET", redirect: "follow",
        headers: Object.assign({ Accept: "application/json" }, headers()),
      });
      if (response.status < 200 || response.status >= 300) return null;
      return JSON.parse(yield response.text());
    } catch (error) { return null; }
  });
}

function absoluteUrl(value) {
  if (typeof value !== "string") return "";
  value = value.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf("//") === 0) return "https:" + value;
  return value.charAt(0) === "/" ? BASE_URL + value : "";
}

// Compare full titles/aliases, retaining non-Latin letters and season numbers.
function normalizeTitle(value) {
  return String(value || "").toLowerCase()
    .replace(/\s*[([]?(?:dublado|legendado)[)\]]?\s*$/, "")
    .replace(/[áàâãä]/g, "a").replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i").replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u").replace(/ç/g, "c")
    .replace(/[\s.,:;!?"'’‘`´\-_\/()[\]{}★☆·…]/g, "");
}

function titlesOf(series) {
  return [series.title, series.tmdb_title].concat(
    typeof series.alt_titles === "string" ? series.alt_titles.split(/\r?\n/) : []
  ).filter(Boolean);
}

function titleMatches(series, info) {
  return titlesOf(series).some(function (title) {
    var normalized = normalizeTitle(title);
    return normalized && info.titles.some(function (expected) {
      return normalizeTitle(expected) === normalized;
    });
  });
}

function getTmdbInfo(id, type, season) {
  return __async(this, null, function* () {
    var base = "https://api.themoviedb.org/3/" + type + "/" + id;
    var data = yield fetchJson(base + "?api_key=" + TMDB_API_KEY +
      "&language=pt-BR&append_to_response=alternative_titles");
    if (!data || String(data.id) !== String(id)) return null;
    var titles = [data.title || data.name, data.original_title || data.original_name];
    var alternatives = data.alternative_titles || {};
    (alternatives.results || alternatives.titles || []).forEach(function (item) {
      if (item && /^(JP|BR|PT|US|GB)$/.test(item.iso_3166_1)) titles.push(item.title);
    });
    var unique = [];
    titles.forEach(function (title) {
      if (typeof title === "string" && title.trim() && unique.indexOf(title.trim()) === -1) {
        unique.push(title.trim());
      }
    });
    var year = (data.release_date || data.first_air_date || "").slice(0, 4);
    var seasonYear = "";
    if (type === "tv" && season > 1) {
      var seasonInfo = yield fetchJson(base + "/season/" + season + "?api_key=" + TMDB_API_KEY);
      seasonYear = seasonInfo && (seasonInfo.air_date || "").slice(0, 4);
    }
    return { id: String(id), titles: unique, year: year, seasonYear: seasonYear };
  });
}

function searchAnime(query) {
  return __async(this, null, function* () {
    var results = [], seen = {};
    for (var page = 1; page <= 5; page++) {
      var url = BASE_URL + "/api/series?pagination=1&page=" + page + "&per_page=50";
      url += query ? "&q=" + encodeURIComponent(query) : "&sort=popular";
      var data = yield fetchJson(url);
      if (!data || !Array.isArray(data.series)) break;
      var added = 0;
      data.series.forEach(function (item) {
        if (item && item.id && !seen[item.id]) {
          seen[item.id] = true; results.push(item); added++;
        }
      });
      if (!data.has_more || !added) break;
    }
    return results;
  });
}

function getDetails(id, page) {
  return fetchJson(BASE_URL + "/api/series/" + id + "?page=" + (page || 1) + "&per_page=200");
}

function ownVersion(detail) {
  var id = String(detail.series.id);
  var versions = Array.isArray(detail.versions) ? detail.versions : [];
  for (var i = 0; i < versions.length; i++) {
    var version = versions[i];
    if (String(version.series_id) === id || (version.series_ids || []).some(function (other) {
      return String(other) === id;
    })) return version;
  }
  return null;
}

function seasonOf(detail) {
  var version = ownVersion(detail);
  var value = detail.series.tmdb_season;
  if (value == null || value === "") value = version ? version.season : (detail.seo || {}).season;
  return value == null ? null : Number(value);
}

function formatOf(detail) {
  var format = (detail.seo || {}).format;
  return format || (detail.series.category === "filme" ? "movie" : "tv");
}

function matchesWork(detail, info, type, linked) {
  if (!detail || !detail.series || formatOf(detail) !== type) return false;
  var series = detail.series;
  if (series.tmdb_id) return String(series.tmdb_id) === info.id;
  // Only versions explicitly linked by the API may have a different season title/year.
  if (linked && type === "tv") return true;
  if (!titleMatches(series, info)) return false;
  return !series.year || !info.year || String(series.year) === info.year ||
    (type === "tv" && String(series.year) === info.seasonYear);
}

function getEpisodes(id, firstPage) {
  return __async(this, null, function* () {
    var episodes = [], seen = {};
    for (var page = 1; page <= 20; page++) {
      var data = page === 1 && firstPage ? firstPage : yield getDetails(id, page);
      if (!data || !data.series || String(data.series.id) !== String(id) || !Array.isArray(data.episodes)) return [];
      var added = 0;
      data.episodes.forEach(function (item) {
        if (item && item.id && !seen[item.id]) {
          seen[item.id] = true; episodes.push(item); added++;
        }
      });
      if (!data.has_more) {
        return episodes.sort(function (a, b) { return Number(a.episode_number) - Number(b.episode_number); });
      }
      if (!added) return [];
    }
    // Incomplete/looping pagination must not silently select a partial episode list.
    return [];
  });
}

function episodeStreams(data, detail, type, season, number) {
  if (!data || !data.episode || !Array.isArray(data.sources)) return [];
  var streams = [], seen = {};
  data.sources.forEach(function (source) {
    if (!source || source.native_video !== true || String(source.kind).toLowerCase() === "embed") return;
    var url = absoluteUrl(source.url);
    if (!url || seen[url]) return;
    seen[url] = true;
    var isHls = source.media_kind === "s6" || /\.m3u8(?:[?&#]|$)/i.test(url);
    var audio = source.audio || (ownVersion(detail) || {}).audio || detail.series.category;
    var label = audio === "dublado" ? "PT-BR DUB" : audio === "legendado" ? "PT-BR LEG" : "PT-BR";
    var stream = {
      name: "AnimesFHD" + (isHls ? " · HLS" : ""),
      title: detail.series.title + (type === "tv" ? " S" + season + "E" + number : "") +
        " [" + label + "] · " + (source.label || "Player"),
      quality: "Auto",
      // Preserve the public resolver: the player follows its 307 to the current media URL.
      url: url,
      headers: headers(),
      behaviorHints: { notWebReady: true, bingeGroup: "animesfhd-" + detail.series.id + "-" + audio },
      provider: "animesfhd",
    };
    if (isHls) stream.type = "hls";
    else if (/\.mp4(?:[?&#]|$)/i.test(url)) stream.type = "mp4";
    // Opaque resolvers can redirect to either MP4 or HLS; do not guess their format.
    var subtitle = absoluteUrl(source.subtitle_url) || absoluteUrl(data.episode.subtitle_url);
    if (subtitle) stream.subtitles = [{ label: "Português (Brasil)", url: subtitle }];
    streams.push(stream);
  });
  return streams;
}

function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    try {
      if (!/^[1-9]\d*$/.test(String(tmdbId)) || (type !== "tv" && type !== "movie")) return [];
      season = season == null ? 1 : Number(season);
      episode = episode == null ? 1 : Number(episode);
      if (type === "tv" && (!(season > 0) || season % 1 || !(episode > 0) || episode % 1)) return [];
      var info = yield getTmdbInfo(tmdbId, type, season);
      if (!info || !info.titles.length) return [];
      var cache = {}, seenCandidates = {}, seenVersions = {}, seenUrls = {};
      var streams = [], inspected = 0;
      for (var q = 0; q < info.titles.length && q < 6 && inspected < 12; q++) {
        var candidates = yield searchAnime(info.titles[q]);
        for (var c = 0; c < candidates.length && inspected < 12; c++) {
          var candidate = candidates[c];
          if (seenCandidates[candidate.id] || !titleMatches(candidate, info)) continue;
          seenCandidates[candidate.id] = true; inspected++;
          var root = cache[candidate.id] || (yield getDetails(candidate.id));
          if (!matchesWork(root, info, type, false)) continue;
          cache[candidate.id] = root;
          var versions = [{ series_id: root.series.id }];
          (root.versions || []).forEach(function (version) {
            if (version.series_id && !Number(version.part) && (type === "movie" || Number(version.season) === season)) {
              versions.push(version);
            }
          });
          for (var v = 0; v < versions.length && v < 12; v++) {
            var id = versions[v].series_id;
            if (seenVersions[id]) continue;
            seenVersions[id] = true;
            var detail = cache[id] || (yield getDetails(id));
            if (!matchesWork(detail, info, type, String(id) !== String(root.series.id))) continue;
            cache[id] = detail;
            var own = ownVersion(detail);
            // No inferred offsets for split cours or absolute numbering across seasons.
            if (type === "tv" && (seasonOf(detail) !== season || (own && Number(own.part) > 0))) continue;
            var episodes = yield getEpisodes(id, detail);
            var target = type === "movie" ? episodes : episodes.filter(function (item) {
              return Number(item.episode_number) === episode;
            });
            if (target.length !== 1) continue;
            var data = yield fetchJson(BASE_URL + "/api/episodes/" + target[0].id);
            if (!data || !data.episode || String(data.episode.id) !== String(target[0].id) ||
                String(data.episode.series_id) !== String(id)) continue;
            if (type === "tv" && Number(data.episode.episode_number) !== episode) continue;
            episodeStreams(data, detail, type, season, episode).forEach(function (stream) {
              if (!seenUrls[stream.url]) { seenUrls[stream.url] = true; streams.push(stream); }
            });
          }
        }
        if (streams.length) break;
      }
      return streams;
    } catch (error) {
      console.log("[AnimesFHD] Unable to resolve streams: " + error.message);
      return [];
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
  global.getStreams = getStreams;
}
