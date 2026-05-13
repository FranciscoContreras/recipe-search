/**
 * Hardcoded USDA nutrition baseline for ~120 common ingredients.
 *
 * WHY THIS EXISTS
 * ---------------
 * The USDA/OFW/FatSecret text-search pipeline returns different results on
 * different queries for the same ingredient (rate-limiting, ranking variation,
 * data-source drift). For stable, high-frequency ingredients the variance is
 * unacceptable — "butter" should always be 717 kcal/100g, not 900 kcal/100g
 * because the cache was warm with a wrong shortening entry.
 *
 * These values are taken directly from USDA FoodData Central SR Legacy
 * (the most stable, peer-reviewed dataset). They will not drift.
 *
 * HOW MATCHING WORKS
 * ------------------
 * We try MOST-SPECIFIC matches first (multi-word → single-word) so
 * "heavy cream" beats "cream", "apple cider vinegar" beats "vinegar", etc.
 *
 * COVERAGE POLICY
 * ---------------
 * Only add ingredients that are:
 *   (a) unambiguous — no variant matters enough to need a different value, AND
 *   (b) USDA SR Legacy has a clear entry for them.
 * Do NOT add: branded products, multi-component dishes, or anything where
 * the preparation significantly changes the calorie density.
 */

import { UsdaNutrition } from './usda';

/** kcal, protein, fat, carbs, fiber, sugar all per 100g */
type BaselineEntry = [number, number, number, number, number, number]; // cal, pro, fat, carb, fib, sug

// Keys are lowercase, ordered most-specific first within each group.
const BASELINE_TABLE: Record<string, BaselineEntry> = {
    // ─── Fats & oils ─────────────────────────────────────────────── kcal  pro    fat   carb  fib   sug
    'olive oil':             [884,   0,    100,    0,    0,    0],
    'extra virgin olive oil':[884,   0,    100,    0,    0,    0],
    'vegetable oil':         [884,   0,    100,    0,    0,    0],
    'canola oil':            [884,   0,    100,    0,    0,    0],
    'coconut oil':           [892,   0,    100,    0,    0,    0],
    'sesame oil':            [884,   0,    100,    0,    0,    0],
    'avocado oil':           [884,   0,    100,    0,    0,    0],
    'neutral oil':           [884,   0,    100,    0,    0,    0],
    'unsalted butter':       [717,   0.9,   81,   0.1,   0,    0.1],
    'salted butter':         [717,   0.9,   81,   0.1,   0,    0.1],
    'butter':                [717,   0.9,   81,   0.1,   0,    0.1],
    'ghee':                  [900,   0.3,   99.5,  0,    0,    0],
    'lard':                  [902,   0,    100,    0,    0,    0],
    'shortening':            [884,   0,    100,    0,    0,    0],

    // ─── Dairy ───────────────────────────────────────────────────────────────
    'heavy cream':           [345,   2.1,   37,   2.8,   0,    2.8],
    'heavy whipping cream':  [345,   2.1,   37,   2.8,   0,    2.8],
    'whipping cream':        [330,   2.2,   35,   2.9,   0,    3.0],
    'double cream':          [345,   2.1,   37,   2.8,   0,    2.8],
    'light cream':           [195,   2.7,   19.5,  3.7,  0,    3.8],
    'single cream':          [195,   2.7,   19.5,  3.7,  0,    3.8],
    'sour cream':            [198,   2.1,   19.4,  4.6,  0,    0.5],
    'crème fraîche':         [292,   2.1,   30,   3.0,   0,    3.0],
    'cream cheese':          [342,   6.2,   33.8,  3.9,  0,    3.4],
    'mascarpone':            [395,   4.6,   40,   4.0,   0,    4.0],
    'ricotta':               [174,   11.3,  12.9,  3.0,  0,    0.3],
    'whole milk ricotta':    [174,   11.3,  12.9,  3.0,  0,    0.3],
    'whole milk':            [ 61,   3.2,   3.3,   4.8,  0,    5.0],
    'milk':                  [ 61,   3.2,   3.3,   4.8,  0,    5.0],
    'buttermilk':            [ 40,   3.3,   0.9,   4.8,  0,    4.8],
    'full fat coconut milk': [197,   2.0,   21.3,  2.8,  0,    1.6],
    'coconut milk':          [197,   2.0,   21.3,  2.8,  0,    1.6],
    'evaporated milk':       [134,   6.8,   7.6,   10,   0,    10],
    'sweetened condensed milk':[321, 8.0,   8.7,   54,   0,    54],
    'condensed milk':        [321,   8.0,   8.7,   54,   0,    54],
    'almond milk':           [ 17,   0.6,   1.5,   0.6,  0.3,  0],
    'oat milk':              [ 47,   1.0,   1.5,   8.0,  0.8,  3.7],
    'plain greek yogurt':    [ 59,  10.0,   0.4,   3.6,  0,    3.2],
    'greek yogurt':          [ 97,   9.0,   5.0,   3.6,  0,    3.2],
    'plain yogurt':          [ 61,   3.5,   3.3,   4.7,  0,    4.7],
    'parmesan':              [431,  38.5,  28.6,   4.1,  0,    0.9],
    'feta':                  [264,  14.2,  21.3,   4.1,  0,    4.1],
    'mozzarella':            [280,  28.1,  17.1,   2.2,  0,    1.0],
    'cheddar':               [403,  24.9,  33.1,   1.3,  0,    0.5],
    'gruyere':               [413,  29.8,  32.3,   0.4,  0,    0.1],
    'gouda':                 [356,  24.9,  27.4,   2.2,  0,    2.2],
    'roquefort':             [369,  21.5,  30.6,   2.0,  0,    0],
    'blue cheese':           [353,  21.4,  28.7,   2.3,  0,    0.5],

    // ─── Eggs ────────────────────────────────────────────────────────────────
    'eggs':                  [155,  12.6,  10.6,   1.1,  0,    1.1],
    'egg':                   [155,  12.6,  10.6,   1.1,  0,    1.1],
    'large eggs':            [155,  12.6,  10.6,   1.1,  0,    1.1],
    'whole eggs':            [155,  12.6,  10.6,   1.1,  0,    1.1],
    'egg yolks':             [322,  15.9,  26.5,   3.6,  0,    0.6],
    'egg yolk':              [322,  15.9,  26.5,   3.6,  0,    0.6],
    'egg whites':            [ 52,  10.9,   0.2,   0.7,  0,    0.7],
    'egg white':             [ 52,  10.9,   0.2,   0.7,  0,    0.7],

    // ─── Flours & starches ────────────────────────────────────────────────────
    'all purpose flour':     [364,  10.3,   1.0,  76.3,  2.7,  0.3],
    'bread flour':           [361,  11.9,   1.2,  73.0,  2.4,  0.3],
    'whole wheat flour':     [340,  13.2,   2.5,  72.0,  10.6, 0.4],
    'cake flour':            [358,   9.0,   0.9,  77.0,  2.0,  0.3],
    'flour':                 [364,  10.3,   1.0,  76.3,  2.7,  0.3],
    'almond flour':          [576,  21.4,  49.9,  21.6,  12.5, 4.3],
    'almond meal':           [576,  21.4,  49.9,  21.6,  12.5, 4.3],
    'coconut flour':         [400,  19.3,  14.1,  57.6,  38.5, 19.5],
    'cornstarch':            [381,   0.3,   0.1,  91.3,  0.9,  0],
    'corn starch':           [381,   0.3,   0.1,  91.3,  0.9,  0],
    'rice flour':            [366,   5.9,   1.4,  80.1,  2.4,  0.1],
    'potato starch':         [357,   0.1,   0.1,  88.2,  1.4,  0],
    'tapioca starch':        [358,   0,     0,    88.7,   0,    0],
    'panko':                 [395,  14.5,   5.1,  73.0,  3.2,  6.7],
    'breadcrumbs':           [395,  14.5,   5.1,  73.0,  3.2,  6.7],
    'bread crumbs':          [395,  14.5,   5.1,  73.0,  3.2,  6.7],

    // ─── Sugars & sweeteners ─────────────────────────────────────────────────
    'granulated sugar':      [387,   0,     0,    99.8,   0,   99.8],
    'caster sugar':          [387,   0,     0,    99.8,   0,   99.8],
    'white sugar':           [387,   0,     0,    99.8,   0,   99.8],
    'sugar':                 [387,   0,     0,    99.8,   0,   99.8],
    'brown sugar':           [380,   0,     0,    98.1,   0,   97.0],
    'powdered sugar':        [389,   0,     0,    99.8,   0,   99.8],
    'icing sugar':           [389,   0,     0,    99.8,   0,   99.8],
    'honey':                 [304,   0.3,   0,    82.4,   0.2, 82.1],
    'maple syrup':           [260,   0,     0.1,  67.0,   0,   60.5],
    'molasses':              [290,   0,     0.1,  74.7,   0,   56.0],
    'agave':                 [310,   0.1,   0.1,  76.4,   0,   68.0],
    'corn syrup':            [282,   0,     0,    76.8,   0,   30.7],
    'date syrup':            [280,   0.4,   0.1,  75.0,   1.5, 66.0],
    'coconut sugar':         [375,   0,     0,    95.0,   0,   70.0],

    // ─── Salt & leavening ─────────────────────────────────────────────────────
    'kosher salt':           [  0,   0,     0,     0,    0,    0],
    'sea salt':              [  0,   0,     0,     0,    0,    0],
    'table salt':            [  0,   0,     0,     0,    0,    0],
    'salt':                  [  0,   0,     0,     0,    0,    0],
    'baking soda':           [  0,   0,     0,     0,    0,    0],
    'bicarbonate of soda':   [  0,   0,     0,     0,    0,    0],
    'baking powder':         [ 53,   0,     0,    27.7,   0,    0],

    // ─── Aromatics (dry spices — use sparingly, so calorie precision matters less) ──
    'vanilla extract':       [288,   0.1,   0.1,  12.7,   0,   12.7],
    'pure vanilla extract':  [288,   0.1,   0.1,  12.7,   0,   12.7],
    'ground cinnamon':       [247,   3.9,   1.2,  80.6,  53.1,  2.2],
    'cinnamon':              [247,   3.9,   1.2,  80.6,  53.1,  2.2],
    'ground ginger':         [335,   8.9,   4.2,  71.6,  14.1,  3.4],
    'ground nutmeg':         [525,   5.8,  36.3,  49.3,  20.8,  2.9],
    'ground allspice':       [263,   6.1,   8.7,  72.1,  21.6,  0],
    'ground cumin':          [375,  17.8,  22.3,  44.2,  10.5,  2.3],
    'smoked paprika':        [282,  14.1,  12.9,  54.0,  34.9,  10.3],
    'paprika':               [282,  14.1,  12.9,  54.0,  34.9,  10.3],
    'ground turmeric':       [312,   9.7,   3.3,  67.1,  22.7,  3.2],
    'cayenne pepper':        [318,  12.0,  17.3,  56.6,  27.2,  10.3],
    'chili flakes':          [318,  12.0,  17.3,  56.6,  27.2,  10.3],
    'red pepper flakes':     [318,  12.0,  17.3,  56.6,  27.2,  10.3],
    'black pepper':          [251,  10.4,   3.3,  63.9,  25.3,  0.6],
    'white pepper':          [296,  10.4,   2.1,  68.6,  26.2,  0],

    // ─── Common vegetables ────────────────────────────────────────────────────
    'garlic':                [149,   6.4,   0.5,  33.1,   2.1,  1.0],
    'yellow onion':          [ 40,   1.1,   0.1,   9.3,   1.7,  4.2],
    'white onion':           [ 40,   1.1,   0.1,   9.3,   1.7,  4.2],
    'red onion':             [ 40,   1.1,   0.1,   9.3,   1.7,  4.2],
    'onion':                 [ 40,   1.1,   0.1,   9.3,   1.7,  4.2],
    'shallot':               [ 72,   2.5,   0.1,  16.8,   3.2,  7.9],
    'leek':                  [ 61,   1.5,   0.3,  14.2,   1.8,  3.9],
    'scallions':             [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'scallion':              [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'green onions':          [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'green onion':           [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'spring onions':         [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'spring onion':          [ 32,   1.8,   0.2,   7.3,   2.6,  2.3],
    'sweet bell pepper':     [ 20,   0.9,   0.2,   4.6,   1.7,  2.4],
    'bell pepper':           [ 20,   0.9,   0.2,   4.6,   1.7,  2.4],
    'red bell pepper':       [ 31,   1.0,   0.3,   6.0,   2.1,  4.2],
    'tomato':                [ 18,   0.9,   0.2,   3.9,   1.2,  2.6],
    'cherry tomato':         [ 18,   0.9,   0.2,   3.9,   1.2,  2.6],
    'grape tomato':          [ 18,   0.9,   0.2,   3.9,   1.2,  2.6],
    'roma tomato':           [ 18,   0.9,   0.2,   3.9,   1.2,  2.6],
    'plum tomato':           [ 18,   0.9,   0.2,   3.9,   1.2,  2.6],
    'tomato paste':          [ 82,   4.3,   0.5,  18.9,   4.1,  10.8],
    'carrot':                [ 41,   0.9,   0.2,   9.6,   2.8,  4.7],
    'celery':                [ 16,   0.7,   0.2,   3.0,   1.6,  1.3],
    'cucumber':              [ 15,   0.6,   0.1,   3.6,   0.5,  1.7],
    'zucchini':              [ 17,   1.2,   0.3,   3.1,   1.0,  2.5],
    'courgette':             [ 17,   1.2,   0.3,   3.1,   1.0,  2.5],
    'eggplant':              [ 25,   1.0,   0.2,   5.9,   3.0,  3.5],
    'aubergine':             [ 25,   1.0,   0.2,   5.9,   3.0,  3.5],
    'romaine lettuce':       [  17,   1.2,  0.3,   2.9,   2.1,  1.4],
    'iceberg lettuce':       [  14,   0.9,  0.1,   3.0,   1.2,  2.0],
    'lettuce':               [  15,   1.4,  0.2,   2.9,   1.3,  1.5],
    'broccoli':              [ 34,   2.8,   0.4,   6.6,   2.6,  1.7],
    'cauliflower':           [ 25,   1.9,   0.3,   5.0,   2.0,  1.9],
    'spinach':               [ 23,   2.9,   0.4,   3.6,   2.2,  0.4],
    'baby spinach':          [ 23,   2.9,   0.4,   3.6,   2.2,  0.4],
    'kale':                  [ 49,   4.3,   0.9,   8.8,   3.6,  2.3],
    'bok choy':              [ 13,   1.5,   0.2,   2.2,   1.0,  1.2],
    'baby bok choy':         [ 13,   1.5,   0.2,   2.2,   1.0,  1.2],
    'asparagus':             [ 20,   2.2,   0.1,   3.9,   2.1,  1.9],
    'mushroom':              [ 22,   3.1,   0.3,   3.3,   1.0,  2.0],
    'mushrooms':             [ 22,   3.1,   0.3,   3.3,   1.0,  2.0],
    'white mushroom':        [ 22,   3.1,   0.3,   3.3,   1.0,  2.0],
    'portobello mushroom':   [ 26,   2.1,   0.3,   5.0,   1.3,  2.3],
    'shiitake mushroom':     [ 34,   2.2,   0.5,   6.8,   2.5,  2.4],
    'potato':                [ 69,   1.7,   0.1,  15.8,   2.4,  1.0],
    'sweet potato':          [ 86,   1.6,   0.1,  20.1,   3.0,  4.2],
    'pumpkin':               [ 26,   1.0,   0.1,   6.5,   0.5,  2.8],
    'butternut squash':      [ 45,   1.0,   0.1,  11.7,   2.0,  2.2],
    'corn':                  [ 86,   3.3,   1.4,  19.0,   2.7,  6.3],
    'peas':                  [ 81,   5.4,   0.4,  14.5,   5.1,  5.7],
    'green beans':           [ 31,   1.8,   0.2,   7.0,   2.7,  3.4],
    'edamame':               [121,  11.9,   5.2,   8.9,   5.2,  3.0],
    'avocado':               [160,   2.0,  14.7,   8.5,   6.7,  0.7],
    'artichoke':             [ 47,   3.3,   0.2,  10.5,   5.4,  1.3],
    'radish':                [ 16,   0.7,   0.1,   3.4,   1.6,  1.9],
    'beet':                  [ 43,   1.6,   0.2,   9.6,   2.8,  6.8],
    'fennel':                [ 31,   1.2,   0.2,   7.3,   3.1,  3.9],

    // ─── Fresh herbs ──────────────────────────────────────────────────────────
    'cilantro':              [ 23,   2.1,   0.5,   3.7,   2.8,  0.9],
    'cilantro leaves':       [ 23,   2.1,   0.5,   3.7,   2.8,  0.9],
    'parsley':               [ 36,   3.0,   0.8,   6.3,   3.3,  0.9],
    'basil':                 [ 23,   3.2,   0.6,   2.7,   1.6,  0.3],
    'mint':                  [ 70,   3.7,   0.9,  14.9,   8.0,  0.2],
    'thyme':                 [101,   5.6,   1.7,  24.4,  14.0,  0.3],
    'rosemary':              [131,   3.3,   5.9,  20.7,  14.1,  0.3],
    'dill':                  [ 43,   3.5,   1.1,   7.0,   2.1,  0],
    'tarragon':              [295,  22.8,   7.2,  50.2,   7.4,  0],
    'chives':                [ 30,   3.3,   0.7,   4.4,   2.5,  1.9],
    'ginger':                [ 80,   1.8,   0.8,  17.8,   2.0,  1.7],
    'fresh ginger':          [ 80,   1.8,   0.8,  17.8,   2.0,  1.7],

    // ─── Legumes & grains ────────────────────────────────────────────────────
    'chickpeas':             [364,  19.3,   6.0,  60.7,  17.4,  10.7],
    'garbanzo beans':        [364,  19.3,   6.0,  60.7,  17.4,  10.7],
    'lentils':               [352,  25.8,   1.1,  60.1,  30.5,  2.0],
    'black beans':           [341,  21.6,   1.4,  62.4,  15.5,  1.4],
    'kidney beans':          [333,  22.5,   1.1,  60.0,  25.0,  2.2],
    'white beans':           [335,  23.4,   0.9,  60.3,  28.8,  1.3],
    'cannellini beans':      [335,  23.4,   0.9,  60.3,  28.8,  1.3],
    // ─── Cooked grain/legume variants ─────────────────────────────────────────
    // When a recipe explicitly says "cooked white rice" or "cooked pasta", the cooking
    // state is detected and we look up "cooked " + term first. These use cooked-weight
    // calorie densities (~1/3 of dry for rice/pasta due to water absorption).
    'cooked white rice':     [121,   2.7,   0.3,  26.7,   0.4,  0],   // USDA 1 cup = 200g = 242 kcal
    'cooked brown rice':     [112,   2.6,   0.9,  23.0,   1.8,  0],
    'cooked rice':           [121,   2.7,   0.3,  26.7,   0.4,  0],
    'cooked jasmine rice':   [121,   2.7,   0.3,  26.7,   0.4,  0],
    'cooked basmati rice':   [121,   2.7,   0.3,  26.7,   0.4,  0],
    'cooked pasta':          [131,   5.0,   1.1,  25.1,   1.8,  0.5],
    'cooked spaghetti':      [131,   5.0,   1.1,  25.1,   1.8,  0.5],
    'cooked penne':          [131,   5.0,   1.1,  25.1,   1.8,  0.5],
    'cooked noodles':        [138,   4.7,   2.1,  25.0,   1.2,  0],
    'cooked egg noodles':    [138,   4.7,   2.1,  25.0,   1.2,  0],
    'cooked quinoa':         [120,   4.4,   1.9,  21.3,   2.8,  0],
    'cooked oats':           [ 71,   2.5,   1.5,  12.0,   1.7,  0],   // cooked rolled oats ≈ 71 kcal/100g
    'cooked lentils':        [116,   9.0,   0.4,  20.1,   7.9,  1.8],
    'cooked chickpeas':      [164,   8.9,   2.6,  27.4,   7.6,  4.8],
    'cooked black beans':    [132,   8.9,   0.5,  23.7,   8.7,  0.3],
    'cooked kidney beans':   [127,   8.7,   0.5,  22.8,   7.4,  0.3],
    'white rice':            [365,   7.1,   0.7,  80.0,   1.3,  0.1],
    'jasmine rice':          [365,   7.1,   0.7,  80.0,   1.3,  0.1],
    'basmati rice':          [356,   8.7,   0.6,  77.8,   1.4,  0.1],
    'brown rice':            [362,   7.5,   2.7,  76.0,   3.5,  0.7],
    'quinoa':                [368,  14.1,   6.1,  64.2,   7.0,  0],
    'oats':                  [389,  16.9,   6.9,  66.3,  10.6,  0],
    'rolled oats':           [389,  16.9,   6.9,  66.3,  10.6,  0],
    'pasta':                 [371,  13.0,   1.5,  74.7,   3.2,  0.6],
    'spaghetti':             [371,  13.0,   1.5,  74.7,   3.2,  0.6],
    'glutinous rice flour':  [366,   6.1,   0.6,  80.4,   2.8,  0],
    'sticky rice':           [370,   6.8,   0.6,  81.7,   1.0,  0],

    // ─── Nuts & seeds ─────────────────────────────────────────────────────────
    'pumpkin seeds':         [559,  30.2,  49.1,  10.7,   6.0,  1.4],
    'pepitas':               [559,  30.2,  49.1,  10.7,   6.0,  1.4],
    'sunflower seeds':       [584,  20.8,  51.5,  20.0,   8.6,  2.6],
    'sesame seeds':          [573,  17.7,  49.7,  23.5,  11.8,  0.3],
    'tahini':                [595,  17.0,  53.8,  21.2,   9.3,  0.5],
    'almonds':               [579,  21.2,  49.9,  21.6,  12.5,  4.4],
    'walnuts':               [654,  15.2,  65.2,  13.7,   6.7,  2.6],
    'pecans':                [691,   9.2,  72.0,  13.9,   9.6,  4.0],
    'cashews':               [553,  18.2,  43.8,  30.2,   3.3,  5.9],
    'macadamia nuts':        [718,   7.9,  75.8,  13.8,   8.6,  4.6],
    'pine nuts':             [673,  13.7,  68.4,  13.1,   3.7,  3.6],
    'hazelnuts':             [628,  15.0,  60.8,  16.7,  9.7,  4.3],
    'pistachios':            [562,  20.6,  45.4,  27.5,  10.3,  7.7],
    'peanuts':               [567,  25.8,  49.2,  16.1,   8.5,  4.7],
    'peanut butter':         [588,  25.1,  50.4,  20.0,   6.0,  9.0],
    'almond butter':         [614,  21.1,  55.5,  18.8,   10.3,  5.0],
    'flaxseed':              [534,  18.3,  42.2,  28.9,  27.3,  1.6],
    'chia seeds':            [486,  16.5,  30.7,  42.1,  34.4,  0],

    // ─── Proteins ─────────────────────────────────────────────────────────────
    'whole chicken':         [189,  18.6,  12.6,   0,    0,    0],  // whole raw with skin ≈ 189 kcal/100g
    'whole small chicken':   [189,  18.6,  12.6,   0,    0,    0],
    'small chicken':         [189,  18.6,  12.6,   0,    0,    0],
    'whole large chicken':   [189,  18.6,  12.6,   0,    0,    0],
    'whole roast chicken':   [215,  24.7,  12.5,   0,    0,    0],
    'roast chicken':         [215,  24.7,  12.5,   0,    0,    0],
    'spatchcock chicken':    [189,  18.6,  12.6,   0,    0,    0],
    'spatchcocked chicken':  [189,  18.6,  12.6,   0,    0,    0],
    'chicken breast':        [120,  22.5,   2.6,   0,    0,    0],
    'chicken thigh':         [179,  16.7,  12.0,   0,    0,    0],
    'ground beef':           [253,  17.2,  20.0,   0,    0,    0],
    'ground pork':           [218,  18.3,  15.5,   0,    0,    0],
    'ground turkey':         [149,  19.7,   7.7,   0,    0,    0],
    'salmon':                [208,  20.4,  13.4,   0,    0,    0],
    'atlantic salmon':       [208,  20.4,  13.4,   0,    0,    0],
    'shrimp':                [106,  20.1,   1.7,   0.9,  0,    0],
    'prawns':                [106,  20.1,   1.7,   0.9,  0,    0],
    'mussels':               [ 86,  11.9,   2.2,   3.7,  0,    0],
    'clams':                 [ 74,  12.8,   1.0,   2.6,  0,    0],
    'scallops':              [ 88,  16.8,   0.8,   2.4,  0,    0],
    'firm tofu':             [ 76,   8.1,   4.2,   1.9,  0.3,  0.9],
    'silken tofu':           [ 55,   5.3,   2.7,   1.4,  0.1,  0.9],
    'tempeh':                [193,  18.5,  10.8,   9.4,  0,    0],
    'cod':                   [ 82,  17.8,   0.7,   0,    0,    0],
    'halibut':               [111,  20.8,   2.3,   0,    0,    0],
    'tuna':                  [144,  23.3,   4.9,   0,    0,    0],
    'bacon':                 [541,  37.0,  42.0,   1.4,  0,    0],

    // ─── Condiments & sauces ──────────────────────────────────────────────────
    'soy sauce':             [ 53,   8.1,   0.1,   4.9,  0.8,  1.7],
    'tamari':                [ 60,  10.9,   0,     5.6,  0.8,  1.7],
    'fish sauce':            [ 35,   5.1,   0,     3.6,  0,    3.6],
    'oyster sauce':          [ 51,   2.5,   0.3,  10.5,  0.2,  7.4],
    'worcestershire sauce':  [ 78,   0.0,   0.1,  19.5,  0,    0],
    'hot sauce':             [ 28,   1.5,   0.8,   5.4,  0.3,  4.0],
    'sriracha':              [ 93,   2.0,   1.0,  20.0,  1.0,  15.0],
    'ketchup':               [112,   1.3,   0.2,  28.4,  0.3,  22.0],
    'dijon mustard':         [ 66,   3.7,   3.7,   6.4,  4.5,  1.3],
    'yellow mustard':        [ 66,   4.4,   4.3,   6.4,  4.2,  1.2],
    'whole grain mustard':   [ 73,   4.4,   4.8,   6.9,  4.7,  1.6],
    'apple cider vinegar':   [ 21,   0,     0,     0.9,  0,    0.4],
    'red wine vinegar':      [ 19,   0.1,   0,     0.3,  0,    0.3],
    'balsamic vinegar':      [ 88,   0.5,   0,    17.0,  0,    14.5],
    'white wine vinegar':    [ 18,   0,     0,     0.1,  0,    0],
    'rice vinegar':          [ 18,   0,     0,     0.6,  0,    0.6],
    'miso paste':            [199,  11.7,   6.0,  26.5,  5.4,  6.2],
    'white miso':            [199,  11.7,   6.0,  26.5,  5.4,  6.2],
    'red miso':              [199,  11.7,   6.0,  26.5,  5.4,  6.2],
    'hummus':                [177,   4.9,   9.6,  20.1,   4.0,  0.3],
    'coconut aminos':        [ 47,   1.0,   0,    11.0,   0,    9.0],
    'hoisin sauce':          [220,   4.1,   4.8,  42.0,   1.7,  24.0],

    // ─── Liquids & acids ─────────────────────────────────────────────────────
    'water':                 [  0,   0,     0,     0,    0,    0],
    'lemon zest':            [ 47,   1.5,   0.3,  16.0,  10.6, 4.5],  // 1 tbsp ≈ 6g
    'orange zest':           [ 97,   1.5,   0.2,  25.0,  10.6, 4.3],
    'lime zest':             [ 30,   0.7,   0.2,  10.5,  10.5, 1.7],
    'lemon juice':           [ 22,   0.4,   0.2,   6.9,  0.3,  2.5],
    'fresh lemon juice':     [ 22,   0.4,   0.2,   6.9,  0.3,  2.5],
    'lime juice':            [ 25,   0.4,   0.1,   8.4,  0.4,  1.7],
    'orange juice':          [ 45,   0.7,   0.2,  10.4,  0.2,  8.4],
    'chicken stock':         [  7,   0.7,   0.2,   0.9,  0,    0.3],
    'chicken broth':         [  7,   0.7,   0.2,   0.9,  0,    0.3],
    'vegetable stock':       [  6,   0.2,   0.1,   1.3,  0.2,  0.7],
    'vegetable broth':       [  6,   0.2,   0.1,   1.3,  0.2,  0.7],
    'beef stock':            [ 12,   1.5,   0.3,   0.4,  0,    0],
    'beef broth':            [ 12,   1.5,   0.3,   0.4,  0,    0],
    'dry white wine':        [ 82,   0.1,   0,     2.6,  0,    0.6],
    'white wine':            [ 82,   0.1,   0,     2.6,  0,    0.6],
    'dry red wine':          [ 85,   0.1,   0,     2.6,  0,    0.6],
    'red wine':              [ 85,   0.1,   0,     2.6,  0,    0.6],
    'beer':                  [ 43,   0.5,   0,     3.6,  0,    0],
    'bourbon':               [231,   0,     0,     0,    0,    0],
    'whiskey':               [231,   0,     0,     0,    0,    0],
    'vodka':                 [231,   0,     0,     0,    0,    0],
    'rum':                   [231,   0,     0,     0,    0,    0],
    'brandy':                [231,   0,     0,     0,    0,    0],
    'coconut cream':         [330,   3.2,  34.7,   6.0,  2.2,  3.0],
    'full fat coconut cream':[330,   3.2,  34.7,   6.0,  2.2,  3.0],
};

// Additional single-word fallbacks (checked only when multi-word didn't match)
const SINGLE_WORD_FALLBACKS: Record<string, BaselineEntry> = {
    'oil':       [884,   0,   100,    0,    0,    0],
    'butter':    [717,   0.9,  81,   0.1,   0,    0.1],
    'cream':     [345,   2.1,  37,   2.8,   0,    2.8],
    'salt':      [  0,   0,    0,     0,    0,    0],
    'flour':     [364,  10.3,  1.0,  76.3,  2.7,  0.3],
    'sugar':     [387,   0,    0,    99.8,   0,   99.8],
    'milk':      [ 61,   3.2,  3.3,   4.8,  0,    5.0],
    'honey':     [304,   0.3,  0,    82.4,  0.2,  82.1],
    'egg':       [155,  12.6, 10.6,   1.1,  0,    1.1],
    'eggs':      [155,  12.6, 10.6,   1.1,  0,    1.1],
    'garlic':    [149,   6.4,  0.5,  33.1,  2.1,  1.0],
    'water':     [  0,   0,    0,     0,    0,    0],
    'stock':     [  7,   0.7,  0.2,   0.9,  0,    0.3],
    'broth':     [  7,   0.7,  0.2,   0.9,  0,    0.3],
    'wine':      [ 83,   0.1,  0,     2.6,  0,    0.6],
    'pepper':    [ 20,   0.9,  0.2,   4.6,  1.7,  2.4], // default to sweet pepper in vegetable context
    'onion':     [ 40,   1.1,  0.1,   9.3,  1.7,  4.2],
    'shallot':   [ 72,   2.5,  0.1,  16.8,  3.2,  7.9],
    'tomato':    [ 18,   0.9,  0.2,   3.9,  1.2,  2.6],
    'spinach':   [ 23,   2.9,  0.4,   3.6,  2.2,  0.4],
    'broccoli':  [ 34,   2.8,  0.4,   6.6,  2.6,  1.7],
    'mushroom':  [ 22,   3.1,  0.3,   3.3,  1.0,  2.0],
    'mushrooms': [ 22,   3.1,  0.3,   3.3,  1.0,  2.0],
    'asparagus': [ 20,   2.2,  0.1,   3.9,  2.1,  1.9],
    'carrot':    [ 41,   0.9,  0.2,   9.6,  2.8,  4.7],
    'potato':    [ 69,   1.7,  0.1,  15.8,  2.4,  1.0],
    'salmon':    [208,  20.4, 13.4,   0,    0,    0],
    'shrimp':    [106,  20.1,  1.7,   0.9,  0,    0],
    'mussels':   [ 86,  11.9,  2.2,   3.7,  0,    0],
    'tahini':    [595,  17.0, 53.8,  21.2,  9.3,  0.5],
    'parmesan':  [431,  38.5, 28.6,   4.1,  0,    0.9],
    'pasta':     [371,  13.0,  1.5,  74.7,  3.2,  0.6],
    'rice':      [365,   7.1,  0.7,  80.0,  1.3,  0.1],
    'oats':      [389,  16.9,  6.9,  66.3, 10.6,  0],
    'lentils':   [352,  25.8,  1.1,  60.1, 30.5,  2.0],
    'chickpeas': [364,  19.3,  6.0,  60.7, 17.4, 10.7],
    'tofu':      [ 76,   8.1,  4.2,   1.9,  0.3,  0.9],
    'avocado':   [160,   2.0, 14.7,   8.5,  6.7,  0.7],
    'almonds':   [579,  21.2, 49.9,  21.6, 12.5,  4.4],
    'walnuts':   [654,  15.2, 65.2,  13.7,  6.7,  2.6],
    'peanuts':   [567,  25.8, 49.2,  16.1,  8.5,  4.7],
    'pepitas':   [559,  30.2, 49.1,  10.7,  6.0,  1.4],
    'cilantro':  [ 23,   2.1,  0.5,   3.7,  2.8,  0.9],
    'parsley':   [ 36,   3.0,  0.8,   6.3,  3.3,  0.9],
    'basil':     [ 23,   3.2,  0.6,   2.7,  1.6,  0.3],
    'ginger':    [ 80,   1.8,  0.8,  17.8,  2.0,  1.7],
    'coconut':   [354,   3.3, 33.5,  15.2,  9.0,  6.2],
    'molasses':  [290,   0,    0.1,  74.7,  0,   56.0],
    'miso':      [199,  11.7,  6.0,  26.5,  5.4,  6.2],
};

function entryToNutrition([cal, pro, fat, carb, fib, sug]: BaselineEntry): UsdaNutrition {
    return {
        calories:       cal,
        protein:        pro,
        fat:            fat,
        carbs:          carb,
        fiber:          fib,
        sugar:          sug,
        calcium_mg:     0,
        iron_mg:        0,
        vitamin_a_mcg:  0,
        vitamin_c_mg:   0,
        serving_size_g: 100,
        portions:       [],
    };
}

/**
 * Look up nutrition from the hardcoded baseline table.
 * Returns null if the term isn't in the table — caller falls through to USDA.
 *
 * Matching strategy:
 *   1. Exact match on the full cleaned term
 *   2. Longest WORD-BOUNDARY match — the key must appear as a complete phrase,
 *      not embedded within a word.  CRITICAL: plain .includes() produced false
 *      positives like "collard" → "lard" (902 kcal/100g instead of 32) because
 *      "col**lard**" contains the substring "lard".
 *   3. Single-word fallback for the last significant word
 */

// Pre-compiled regex cache for word-boundary matching (built once at module load)
const _keyRegexCache = new Map<string, RegExp>();
function keyRegex(key: string): RegExp {
    if (!_keyRegexCache.has(key)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        _keyRegexCache.set(key, new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i'));
    }
    return _keyRegexCache.get(key)!;
}

export function lookupBaseline(cleanedTerm: string): UsdaNutrition | null {
    const t = cleanedTerm.toLowerCase().trim();
    if (!t) return null;

    // 1. Exact match
    if (BASELINE_TABLE[t]) return entryToNutrition(BASELINE_TABLE[t]);

    // 2. Longest word-boundary match — key must appear as a standalone phrase.
    //    E.g., "unsalted butter at room temp" → matches "unsalted butter" ✓
    //          "whole collard green leaves"   → does NOT match "lard"     ✓
    //          "applewood smoked bacon"       → matches "bacon"           ✓
    let bestKey = '';
    for (const key of Object.keys(BASELINE_TABLE)) {
        if (key.length > bestKey.length && keyRegex(key).test(t)) {
            bestKey = key;
        }
    }
    if (bestKey) return entryToNutrition(BASELINE_TABLE[bestKey]);

    // 3. Single-word fallback (last significant word of the term)
    //    Words are already complete tokens from the split so no boundary issue here.
    const words = t.split(/\s+/).filter(w => w.length >= 3);
    for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        if (SINGLE_WORD_FALLBACKS[w]) return entryToNutrition(SINGLE_WORD_FALLBACKS[w]);
    }

    return null;
}
