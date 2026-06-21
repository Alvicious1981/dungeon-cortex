import { http, HttpResponse } from "msw";

import {
  blindedConditionFixture,
  conditionsIndexFixture,
  goblinFixture,
  monstersIndexFixture,
} from "../fixtures/dnd5e";

const DND_5E_API_BASE_URL = "https://www.dnd5eapi.co/api/2014";

export const handlers = [
  http.get(`${DND_5E_API_BASE_URL}/monsters/goblin`, () => {
    return HttpResponse.json({
      ...goblinFixture,
      senses: { darkvision: "60 ft.", passive_perception: 9 },
      languages: "Common, Goblin",
      challenge_rating: 0.25,
    });
  }),
  http.get(`${DND_5E_API_BASE_URL}/monsters`, () => {
    return HttpResponse.json(monstersIndexFixture);
  }),
  http.get(`${DND_5E_API_BASE_URL}/conditions/blinded`, () => {
    return HttpResponse.json(blindedConditionFixture);
  }),
  http.get(`${DND_5E_API_BASE_URL}/conditions`, () => {
    return HttpResponse.json(conditionsIndexFixture);
  }),
];