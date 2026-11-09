const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { buildSet } = require('../sql');
const { assertCanManage, getPublicRestaurant } = require('./restaurantService');

const PLAN_COLUMNS = 'id, restaurant_id, name, description, meal_slot, meals_count, price_paise, is_active';

function toPlan(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    mealSlot: row.meal_slot,
    mealsCount: row.meals_count,
    pricePaise: row.price_paise,
    pricePerMealPaise: Math.round(row.price_paise / row.meals_count),
    isActive: row.is_active,
  };
}

function mapPlanConflict(err) {
  if (err.code === '23505' && err.constraint === 'subscription_plans_restaurant_id_name_key') {
    return new AppError(409, 'PLAN_EXISTS', 'This restaurant already has a plan with this name');
  }
  return err;
}

// Public: the active plans of an active restaurant.
async function listPublicPlans(restaurantId) {
  await getPublicRestaurant(restaurantId); // 404 if missing or inactive
  const { rows } = await pool.query(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans
     WHERE restaurant_id = $1 AND is_active
     ORDER BY meal_slot, meals_count, id`,
    [restaurantId],
  );
  return rows.map(toPlan);
}

async function createPlan(user, restaurantId, input) {
  try {
    return await withTransaction(async (client) => {
      await assertCanManage(client, user, restaurantId); // owner or admin
      const { rows } = await client.query(
        `INSERT INTO subscription_plans (restaurant_id, name, description, meal_slot, meals_count, price_paise)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${PLAN_COLUMNS}`,
        [restaurantId, input.name, input.description ?? null, input.mealSlot, input.mealsCount,
          input.pricePaise],
      );
      return toPlan(rows[0]);
    });
  } catch (err) {
    throw mapPlanConflict(err);
  }
}

// Meal slot and meal count are fixed once a plan exists: subscribers bought exactly that.
// A price change applies to new subscriptions only; existing ones keep their snapshot.
const PLAN_UPDATABLE = {
  name: 'name',
  description: 'description',
  pricePaise: 'price_paise',
  isActive: 'is_active',
};

async function updatePlan(user, restaurantId, planId, patch) {
  try {
    return await withTransaction(async (client) => {
      await assertCanManage(client, user, restaurantId);
      const values = [planId, restaurantId];
      const set = buildSet(patch, PLAN_UPDATABLE, values);
      // Scoped to the restaurant in the URL (like menu items).
      const { rows } = await client.query(
        `UPDATE subscription_plans SET ${set} WHERE id = $1 AND restaurant_id = $2 RETURNING ${PLAN_COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan not found');
      return toPlan(rows[0]);
    });
  } catch (err) {
    throw mapPlanConflict(err);
  }
}

module.exports = { listPublicPlans, createPlan, updatePlan };
