import { getStore } from '@netlify/blobs';
import seeds from '../data/seeds.json' with { type: 'json' };
import { createHandler } from '../lib/api.mjs';

export default async (request, context) => {
  return createHandler({
    store:getStore({name:'trip-2026',consistency:'strong'}), seeds,
    pin:process.env.TRIP_EDIT_PIN, secret:process.env.TRIP_SESSION_SECRET,
  })(request,context);
};
