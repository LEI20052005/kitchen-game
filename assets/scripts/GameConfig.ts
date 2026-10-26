/**
 * ============================================================
 * GameConfig.ts —— 游戏固定规则配置（食材分类 + 配方表 + 匹配函数）
 *
 * 【本文件定位】
 * - 纯数据 + 纯函数模块：不依赖任何引擎组件，只使用 TypeScript，
 *   便于单独阅读、单元测试，也方便以后把规则抽成 JSON/配置表。
 * - 规则基准：2026-10-24 定稿；2026-10-25 改版（数量必须正好，多一勺都不行）。
 *
 * 【约定】
 * - 规则名（葱花/花生油/蛋粥/葱花蛋炒饭）与素材文件名（葱/食用油/鸡蛋粥/葱花煎蛋饭）
 *   不一致，这里统一：逻辑用 name，加载图片用 sprite。
 * ============================================================
 */

// ---------- 1. 食材 ID 枚举 ----------
// 用枚举统一管理食材标识：代码里写字符串容易拼错，
// 枚举能在编译期帮我们检查拼写，语义也更清晰。
export enum IngredientId {
    // —— 基础食材（无限刷新）——
    RiceRaw = 'rice_raw',       // 大米
    Water = 'water',            // 水
    Egg = 'egg',                // 鸡蛋
    Scallion = 'scallion',      // 葱花（素材：葱.png）
    Salt = 'salt',              // 盐
    SoySauce = 'soy_sauce',     // 酱油
    Oil = 'oil',                // 花生油（素材：食用油.png）

    // —— 合成菜品（一次性消耗品）——
    Rice = 'rice',              // 米饭
    FriedRice = 'fried_rice',   // 蛋炒饭
    ScallionEgg = 'scallion_egg',           // 葱花煎蛋
    EggPorridge = 'egg_porridge',           // 蛋粥（素材：鸡蛋粥.png）
    ScallionFriedRice = 'scallion_fried_rice', // 葱花蛋炒饭（素材：葱花煎蛋饭.png，目标菜品）

    // —— 失败产物 ——
    DarkDish = 'dark_dish',     // 黑暗料理（失败时产出，不能下锅）
}

// ---------- 2. 食材定义 ----------
/** 单个食材的静态信息 */
export interface IngredientDef {
    id: IngredientId;
    /** 中文名（图鉴、弹窗、日志显示用） */
    name: string;
    /** 素材文件名（不带 .png 后缀），对应 assets/UI/ 下的图片 */
    sprite: string;
    /** 是否基础食材（无限刷新、拖走自动复原） */
    isBasic: boolean;
    /** 是否合成菜品（一次性消耗品） */
    isProduct: boolean;
    /** 是否目标菜品（做出即通关） */
    isTarget?: boolean;
    /** 是否失败产物（黑暗料理） */
    isFailure?: boolean;
}

/** 全部食材字典：以 id 为键，O(1) 查询 */
export const INGREDIENTS: Record<IngredientId, IngredientDef> = {
    [IngredientId.RiceRaw]:          { id: IngredientId.RiceRaw,          name: '大米',       sprite: '大米',       isBasic: true,  isProduct: false },
    [IngredientId.Water]:            { id: IngredientId.Water,            name: '水',         sprite: '水',         isBasic: true,  isProduct: false },
    [IngredientId.Egg]:              { id: IngredientId.Egg,              name: '鸡蛋',       sprite: '鸡蛋',       isBasic: true,  isProduct: false },
    [IngredientId.Scallion]:         { id: IngredientId.Scallion,         name: '葱花',       sprite: '葱',         isBasic: true,  isProduct: false },
    [IngredientId.Salt]:             { id: IngredientId.Salt,             name: '盐',         sprite: '盐',         isBasic: true,  isProduct: false },
    [IngredientId.SoySauce]:         { id: IngredientId.SoySauce,         name: '酱油',       sprite: '酱油',       isBasic: true,  isProduct: false },
    [IngredientId.Oil]:              { id: IngredientId.Oil,              name: '花生油',     sprite: '食用油',     isBasic: true,  isProduct: false },

    [IngredientId.Rice]:             { id: IngredientId.Rice,             name: '米饭',       sprite: '米饭',       isBasic: false, isProduct: true },
    [IngredientId.FriedRice]:        { id: IngredientId.FriedRice,        name: '蛋炒饭',     sprite: '蛋炒饭',     isBasic: false, isProduct: true },
    [IngredientId.ScallionEgg]:      { id: IngredientId.ScallionEgg,      name: '葱花煎蛋',   sprite: '葱花煎蛋',   isBasic: false, isProduct: true },
    [IngredientId.EggPorridge]:      { id: IngredientId.EggPorridge,      name: '蛋粥',       sprite: '鸡蛋粥',     isBasic: false, isProduct: true },
    [IngredientId.ScallionFriedRice]:{ id: IngredientId.ScallionFriedRice, name: '葱花蛋炒饭', sprite: '葱花煎蛋饭', isBasic: false, isProduct: true, isTarget: true },

    [IngredientId.DarkDish]:         { id: IngredientId.DarkDish,         name: '黑暗料理',   sprite: '黑暗料理',   isBasic: false, isProduct: false, isFailure: true },
};

/** 基础食材顺序（食材栏刷新顺序也按此排列） */
export const BASIC_IDS: IngredientId[] = [
    IngredientId.RiceRaw,
    IngredientId.Water,
    IngredientId.Egg,
    IngredientId.Scallion,
    IngredientId.Salt,
    IngredientId.SoySauce,
    IngredientId.Oil,
];

/** 合成菜品列表（图鉴展示顺序也按此排列） */
export const PRODUCT_IDS: IngredientId[] = [
    IngredientId.Rice,
    IngredientId.FriedRice,
    IngredientId.ScallionEgg,
    IngredientId.EggPorridge,
    IngredientId.ScallionFriedRice,
];

// ---------- 3. 配方表 ----------
/** 一条配方的定义 */
export interface RecipeDef {
    /** 产出菜品 id */
    product: IngredientId;
    /** 需求清单：每种食材至少要 min 个 */
    requires: { id: IngredientId; min: number }[];
    /** 备注（如"目标菜品"） */
    note?: string;
}

/** 配方表（2026-10-25 用户改版：数量必须正好，多一勺都不行） */
export const RECIPES: RecipeDef[] = [
    {
        product: IngredientId.Rice,       // 米饭
        requires: [
            { id: IngredientId.RiceRaw, min: 2 },   // 大米 ×2
            { id: IngredientId.Water,   min: 1 },   // 水 ×1
        ],
    },
    {
        product: IngredientId.FriedRice,  // 蛋炒饭
        requires: [
            { id: IngredientId.Rice,     min: 1 },  // 米饭 ×1
            { id: IngredientId.Egg,      min: 1 },  // 鸡蛋 ×1
            { id: IngredientId.SoySauce, min: 1 },  // 酱油 ×1
            { id: IngredientId.Oil,      min: 1 },  // 花生油 ×1
        ],
    },
    {
        product: IngredientId.ScallionEgg, // 葱花煎蛋
        requires: [
            { id: IngredientId.Egg,      min: 3 },  // 鸡蛋 ×3
            { id: IngredientId.Scallion, min: 1 },  // 葱花 ×1
            { id: IngredientId.Salt,     min: 1 },  // 盐 ×1
            { id: IngredientId.Oil,      min: 1 },  // 花生油 ×1
        ],
    },
    {
        product: IngredientId.EggPorridge, // 蛋粥
        requires: [
            { id: IngredientId.RiceRaw,  min: 1 },  // 大米 ×1
            { id: IngredientId.Egg,      min: 1 },  // 鸡蛋 ×1
            { id: IngredientId.Water,    min: 2 },  // 水 ×2
            { id: IngredientId.Salt,     min: 1 },  // 盐 ×1
            { id: IngredientId.Oil,      min: 1 },  // 花生油 ×1
        ],
    },
    {
        product: IngredientId.ScallionFriedRice, // 葱花蛋炒饭（目标菜品）
        requires: [
            { id: IngredientId.FriedRice, min: 1 }, // 蛋炒饭 ×1
            { id: IngredientId.Scallion,  min: 1 }, // 葱花 ×1
        ],
        note: '目标菜品，做出直接通关',
    },
];

// ---------- 4. 匹配函数 ----------
/**
 * 判断某条配方是否满足（2026-10-25 改版：数量必须正好）：
 *  ① 锅内食材的【种类】必须全部落在配方要求集合内（"不允许混入以外食材"）；
 *  ② 每种需求食材的【数量】必须【正好等于】要求数量（多一勺都不行）。
 */
function isRecipeSatisfied(recipe: RecipeDef, pot: Map<IngredientId, number>): boolean {
    // ① 种类检查：遍历锅里每种食材，只要有一种不在配方需求里，直接不匹配
    for (const id of pot.keys()) {
        const found = recipe.requires.some((req) => req.id === id);
        if (!found) {
            return false;
        }
    }
    // ② 数量检查（必须正好）：配方要求的每种食材数量必须与锅内数量完全相等
    for (const req of recipe.requires) {
        const count = pot.get(req.id) || 0;
        if (count !== req.min) {
            return false;
        }
    }
    return true;
}

/**
 * 匹配入口：依次用每条配方去匹配当前锅内食材。
 * 命中返回产出的菜品 id；一条都不命中返回 null（即失败 → 黑暗料理）。
 */
export function matchRecipe(pot: Map<IngredientId, number>): IngredientId | null {
    for (const recipe of RECIPES) {
        if (isRecipeSatisfied(recipe, pot)) {
            return recipe.product;
        }
    }
    return null;
}
