/**
 * ============================================================
 * GameManager.ts —— 游戏全局管理器（挂在 Canvas 节点上）
 *
 * 【职责】
 * - 单例：全游戏唯一入口，其它脚本通过 GameManager.instance 访问
 * - 管理核心状态：锅内食材（Map）、连续失败计数、图鉴解锁（Set）
 * - 接管 UI 按钮：炒菜 / 重置 / 图鉴
 * - 执行炒菜结果判定（成功产出菜品 / 失败黑暗料理）与图鉴解锁
 *
 * 【P2-2 新增】
 * - basicFrames / productFrames：食材图引用（在属性检查器按顺序拖入）
 * - createIngredientNode：食材节点工厂（建 Sprite + 挂 IngredientItem）
 * - spawnBasicToBar / respawnBasic：食材栏开局铺货 + 无限补货
 * - addToPot / removeFromPot / clearPot：锅内容 + 锅内显示节点
 * - isPointInPot / isPointInDesk：拖拽落点命中检测
 *
 * 【当前进度说明】
 * - 炒菜进度条动画、黑烟特效、通关弹窗在 P4 实现
 * - 连败广告提示按钮、图鉴面板在 P5 实现
 * ============================================================
 */
import { _decorator, Component, Node, Button, Sprite, SpriteFrame, UITransform, Vec2, Vec3, find, log, warn, Camera, Color, Layers, Label, Graphics, tween, resources, sys } from 'cc';
import { IngredientId, INGREDIENTS, BASIC_IDS, PRODUCT_IDS, RECIPES, matchRecipe } from './GameConfig';
import { IngredientItem } from './IngredientItem';

const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    /** 全局单例引用：其它脚本通过 GameManager.instance 访问 */
    public static instance: GameManager = null!;

    // ==================== P2-2：食材图片引用（属性检查器里按顺序拖入） ====================

    /** 基础食材图（7 张），顺序必须与 BASIC_IDS 一致：大米/水/鸡蛋/葱花/盐/酱油/花生油 */
    @property({ type: [SpriteFrame], tooltip: '基础食材图，顺序：大米/水/鸡蛋/葱花/盐/酱油/花生油' })
    basicFrames: SpriteFrame[] = [];

    /** 合成菜品图（5 张），顺序必须与 PRODUCT_IDS 一致：米饭/蛋炒饭/葱花煎蛋/蛋粥/葱花蛋炒饭 */
    @property({ type: [SpriteFrame], tooltip: '合成菜品图，顺序：米饭/蛋炒饭/葱花煎蛋/蛋粥/葱花蛋炒饭' })
    productFrames: SpriteFrame[] = [];

    /** 黑暗料理图（失败产物显示）；在属性检查器拖入 黑暗料理.png */
    @property({ type: SpriteFrame, tooltip: '黑暗料理图（失败产物）' })
    darkDishFrame: SpriteFrame | null = null;

    /** 黑烟特效图（失败冒烟）；在属性检查器拖入 assets/UI/黑烟.png（有则直用，无需动态加载） */
    @property({ type: SpriteFrame, tooltip: '黑烟特效图（失败冒烟，拖入 黑烟.png）' })
    smokeFrame: SpriteFrame | null = null;

    /** 星星特效图（通关庆祝）；在属性检查器拖入 assets/UI/星星特效.png（有则直用，无需动态加载） */
    @property({ type: SpriteFrame, tooltip: '星星特效图（通关庆祝，拖入 星星特效.png）' })
    starFrame: SpriteFrame | null = null;

    // ==================== 核心状态 ====================

    /** 锅内食材：食材 id -> 数量（Map 键值对容器，类似 C++ 的 unordered_map） */
    private potContents: Map<IngredientId, number> = new Map();
    /** 连续失败次数（≥2 时弹出模拟激励提示按钮，P5 使用） */
    private loseStreak = 0;
    /** 已解锁图鉴集合（Set 去重集合容器；"永久记录"的持久化在 P5 用 localStorage 做） */
    private unlockedSet: Set<IngredientId> = new Set();
    /** 连败提示面板节点（询问 + 提示内容共用同一个面板） */
    private hintPanelNode: Node | null = null;
    /** 每个菜谱已提示到的食材位数（"再次逐渐解锁多位提示"的进度记录） */
    private hintProgress: Map<IngredientId, number> = new Map();
    /** 通关庆祝屏节点（做出目标菜品后弹出） */
    private winTipNode: Node | null = null;
    /** 待触发通关屏标记：做出目标菜品先记下，等成功提示关闭后再弹，避免两个全屏叠一起 */
    private pendingWin = false;
    /** 是否正在炒菜（动画期间锁定交互，P4 完善） */
    private cooking = false;
    /** 炒菜进度条动画时长（秒）：点开始炒菜 → 进度条跑满 → 再判定结果 */
    private readonly COOK_DURATION = 1.5;
    /** 进度条已播放时长（秒） */
    private cookProgressElapsed = 0;

    // ==================== 节点引用（运行时按名字查找，无需手动拖拽赋值） ====================

    private ingredientBarNode: Node | null = null;  // 基础食材栏 IngredientBar
    private potContentsNode: Node | null = null;    // 锅内食材容器 PotContents
    private deskNode: Node | null = null;           // 桌面 Desk
    private resultDeskNode: Node | null = null;     // 成品放置位 Desk/ResultDesk
    private cookProgressNode: Node | null = null;   // 炒菜进度条 UI/CookProgress（默认隐藏）
    private toastNode: Node | null = null;          // 全屏锅满提示（运行时动态创建）
    private successTipNode: Node | null = null;     // 全屏成功提示（运行时动态创建）
    private failTipNode: Node | null = null;        // 全屏失败提示（黑暗料理，运行时动态创建）
    private bookPanelNode: Node | null = null;      // 菜谱图鉴面板（运行时动态创建）
    private bookPanelVisible = false;               // 图鉴面板是否打开
    private resultNodes: Node[] = [];               // 桌面上的产物（用于排布，避免重叠）
    private geomLogged = false;                     // 几何诊断日志只打印一次

    // ==================== 生命周期 ====================

    onLoad() {
        // 单例赋值：保证全场景只有一个 GameManager 生效
        GameManager.instance = this;

        // 强制相机配置（防止场景配置被误改导致背景色异常）：
        // Main Camera → 清屏米黄 FFF2DE；Canvas/Camera（UI 相机）→ DONT_CLEAR 不覆盖
        const mainCamNode = find('Main Camera');
        const mainCam = mainCamNode ? mainCamNode.getComponent(Camera) : null;
        if (mainCam) {
            mainCam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            mainCam.clearColor = new Color(255, 242, 222, 255); // #FFF2DE
            log('[GameManager] Main Camera 清屏已强制为 SOLID_COLOR + FFF2DE（米黄）');
        } else {
            warn('[GameManager] 找不到 Main Camera，背景色可能异常');
        }
        const uiCamNode = find('Camera', this.node); // Canvas 下的 UI 相机
        const uiCam = uiCamNode ? uiCamNode.getComponent(Camera) : null;
        if (uiCam) {
            uiCam.clearFlags = Camera.ClearFlag.DONT_CLEAR;
            log('[GameManager] UI 相机已强制为 DONT_CLEAR（不覆盖背景）');
        }

        // find(path, this.node) 支持多级路径；每个查找都会做存在性检查
        this.ingredientBarNode = this.requireNode('IngredientBar');
        this.potContentsNode = this.requireNode('PotContents');
        this.deskNode = this.requireNode('Desk');
        this.resultDeskNode = this.requireNode('Desk/ResultDesk');
        this.cookProgressNode = this.requireNode('UI/CookProgress');

        // 三个按钮：查组件并注册点击事件
        const cookBtn = this.findButton('UI/CookButton');
        const resetBtn = this.findButton('UI/ResetButton');
        const bookBtn = this.findButton('UI/BookButton');

        // Button.EventType.CLICK 是按钮的"点击完成"回调类型（比 TOUCH_END 更符合 UI 习惯）
        if (cookBtn) {
            cookBtn.node.on(Button.EventType.CLICK, this.onCookClicked, this);
        }
        if (resetBtn) {
            resetBtn.node.on(Button.EventType.CLICK, this.onResetClicked, this);
        }
        if (bookBtn) {
            bookBtn.node.on(Button.EventType.CLICK, this.onBookClicked, this);
        }
        // 菜谱/重置按钮放大 1.5 倍（90×90 → 135×135），更好点
        this.scaleButtonNode(bookBtn ? bookBtn.node : null, 1.5);
        this.scaleButtonNode(resetBtn ? resetBtn.node : null, 1.5);
    }

    start() {
        // 自愈：把食材栏锚定在画布底部上方 110px 处（相对画布自身尺寸计算）。
        // 等价于设计分辨率 750×1334 下的 (0,-560)，但窗口/画布尺寸变化时不会掉出屏幕。
        if (this.ingredientBarNode) {
            const canvasUt = this.getComponent(UITransform);
            const halfH = canvasUt ? canvasUt.height / 2 : 667; // 画布半高（默认 667）
            // 底部上方 110px（等价于锁定布局下的 -560）
            this.ingredientBarNode.setPosition(0, -halfH + 110, 0);
            const wp = this.ingredientBarNode.worldPosition;
            log(`[GameManager] 食材栏世界坐标 (${wp.x.toFixed(0)}, ${wp.y.toFixed(0)})，画布半高=${halfH.toFixed(0)}`);
        }
        // P2-2：开局把 7 种基础食材各铺 1 个到食材栏（每个槽位固定一种）
        log('[GameManager] 初始化完成，开始铺货基础食材');
        // 恢复持久化解锁进度（P5：刷新页面不丢）
        this.probeLocalStorage();
        try {
            const saved = sys.localStorage.getItem('kitchen_unlocked_v1');
            if (saved) {
                const arr: unknown[] = JSON.parse(saved);
                for (const v of arr) {
                    if (typeof v === 'number' && Number.isInteger(v)) {
                        this.unlockedSet.add(v as IngredientId);
                    }
                }
                log(`[GameManager] 已恢复 ${this.unlockedSet.size} 个已解锁菜谱`);
            }
        } catch (e) {
            warn('[GameManager] 恢复解锁进度失败（不影响本次游戏）：' + e);
        }
        for (let i = 0; i < BASIC_IDS.length; i++) {
            this.spawnBasicToBar(BASIC_IDS[i], i);
        }
        // 调试：打印每个食材的世界坐标与图片名（排查"看不到食材"）
        this.dumpIngredientBar();
        // 屏幕顶部空白处常驻显示游戏目标
        this.createGoalBanner();
    }

    /** 屏幕顶部（两个角按钮之间的空白）常驻显示游戏目标，让玩家一眼知道要做什么 */
    private createGoalBanner(): void {
        const goalNode = new Node('GoalBanner');
        goalNode.layer = Layers.Enum.UI_2D;
        this.node.addChild(goalNode);
        const ut = goalNode.addComponent(UITransform);
        ut.setContentSize(700, 40);
        const lb = goalNode.addComponent(Label);
        lb.fontSize = 24;
        lb.lineHeight = 32;
        lb.isBold = true;
        lb.color = new Color(120, 80, 40, 230);
        lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.verticalAlign = Label.VerticalAlign.CENTER;
        lb.string = '目标：做出葱花蛋炒饭通关！';
        goalNode.setPosition(0, 600, 0);
        log('[GameManager] 游戏目标横幅已显示：目标：做出葱花蛋炒饭通关！');
    }

    /** 调试辅助：打印食材栏下每个食材节点的世界坐标与图片名 */
    private dumpIngredientBar(): void {
        if (!this.ingredientBarNode) {
            return;
        }
        for (const child of this.ingredientBarNode.children) {
            const sp = child.getComponent(Sprite);
            const frameName = sp && sp.spriteFrame ? sp.spriteFrame.name : 'NULL';
            const wp = child.worldPosition;
            log(`[调试] ${child.name} 世界(${wp.x.toFixed(0)},${wp.y.toFixed(0)}) 图片=${frameName}`);
        }
    }

    /** 按路径查找节点（支持 'A/B/C' 多级路径），找不到时打印警告（方便排查层级问题） */
    private requireNode(path: string): Node | null {
        const node = find(path, this.node);
        if (!node) {
            warn(`[GameManager] 找不到节点：${path}，请检查场景层级`);
        }
        return node;
    }

    /** 按路径查找 Button 组件，找不到时打印警告（方便排查层级问题） */
    private findButton(path: string): Button | null {
        const node = find(path, this.node);
        if (!node) {
            warn(`[GameManager] 找不到节点：${path}，请检查场景层级`);
            return null;
        }
        const btn = node.getComponent(Button);
        if (!btn) {
            warn(`[GameManager] 节点 ${path} 缺少 Button 组件`);
            return null;
        }
        return btn;
    }

    /** 按倍数放大按钮：Sprite 强制 CUSTOM 跟随 UITransform 尺寸（90×90 → 135×135） */
    private scaleButtonNode(node: Node | null, factor: number): void {
        if (!node) {
            return;
        }
        const ut = node.getComponent(UITransform);
        if (!ut) {
            return;
        }
        const sp = node.getComponent(Sprite);
        if (sp) {
            sp.sizeMode = Sprite.SizeMode.CUSTOM; // 不设 CUSTOM 的话图片按原图尺寸渲染，改尺寸无效
        }
        ut.setContentSize(ut.width * factor, ut.height * factor);
    }

    // ==================== 食材节点工厂（P2-2） ====================

    /** 按 id 取对应图片（基础食材查 basicFrames，合成菜品查 productFrames，顺序与常量表一致） */
    public getFrame(id: IngredientId): SpriteFrame | null {
        const idxBasic = BASIC_IDS.indexOf(id);
        if (idxBasic >= 0) {
            return this.basicFrames[idxBasic] ?? null;
        }
        const idxProd = PRODUCT_IDS.indexOf(id);
        if (idxProd >= 0) {
            return this.productFrames[idxProd] ?? null;
        }
        // 黑暗料理（失败产物）：走独立图片槽位 darkDishFrame
        if (id === IngredientId.DarkDish) {
            return this.darkDishFrame;
        }
        return null;
    }

    /**
     * 创建任意食材的可拖拽节点：
     * 建一个 90×90 的 Sprite + 自动挂上 IngredientItem 组件
     */
    public createIngredientNode(id: IngredientId): Node {
        const def = INGREDIENTS[id];
        const node = new Node(def.name);            // 新节点（初始在场景外，需 addChild 挂到树上）
        // 关键：new Node() 默认在 DEFAULT 层，而 UI 相机只渲染 UI_2D 层
        // —— 不设这行，节点会被相机"视而不见"（日志正常但画面不显示）
        node.layer = Layers.Enum.UI_2D;
        const ut = node.addComponent(UITransform);  // 尺寸组件：决定触摸命中区域
        ut.setContentSize(90, 90);
        const sprite = node.addComponent(Sprite);   // 显示图片
        // 顺序很重要：先设 CUSTOM（按 UITransform 尺寸绘制），再赋图。
        // 若先赋图，Sprite 会把节点尺寸自动改成图片原始尺寸(2048×2048)，食材会变成巨图。
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = this.getFrame(id);
        ut.setContentSize(90, 90); // 双保险：赋图后再强制一次 90×90
        const item = node.addComponent(IngredientItem); // 拖拽逻辑（运行时挂载，无需编辑器配置）
        item.id = id;
        return node;
    }

    /** 把某基础食材铺到食材栏指定槽位（7 个槽，间距 100px，居中排列） */
    public spawnBasicToBar(id: IngredientId, slotIndex: number): void {
        if (!this.ingredientBarNode) {
            warn('[GameManager] 食材栏节点为空，无法铺货，请检查 IngredientBar 层级');
            return;
        }
        const node = this.createIngredientNode(id);
        this.ingredientBarNode.addChild(node);
        // 槽位 x = (槽号 - 3) * 100 → -300 ~ +300，正好铺满 700 宽的食材栏
        node.setPosition((slotIndex - 3) * 100, 0, 0);
        log(`[GameManager] 铺货：${INGREDIENTS[id].name} → 槽位${slotIndex}`);
    }

    /** 基础食材补货：按 id 找它固定的槽位，重新铺一个（无限刷新） */
    public respawnBasic(id: IngredientId): void {
        const idx = BASIC_IDS.indexOf(id);
        if (idx < 0) {
            return;
        }
        this.spawnBasicToBar(id, idx);
    }

    // ==================== 锅内食材操作 ====================

    /** 把一个食材放入锅（可重复放，数量累加），并在锅里生成显示节点。锅满(9个)时返回 false */
    public addToPot(id: IngredientId): boolean {
        // 黑暗料理允许入锅（2026-10-25 用户要求）：它不是任何配方所需食材，
        // 混入后炒菜必然失败（再出一坨黑暗料理），可用来占锅位 / 消耗掉腾出桌面空间
        // 锅容量上限：3×3 网格 = 最多 9 个，满了不能再放（上屏提示）
        if (this.getPotSize() >= 9) {
            warn('[GameManager] 锅里已放满 9 个食材，放不下了');
            this.showToast('锅已满！\n最多 9 个食材');
            return false;
        }
        const count = this.potContents.get(id) || 0;
        this.potContents.set(id, count + 1);
        log(`[GameManager] 入锅：${INGREDIENTS[id].name}（当前 ${this.potSummary()}）`);

        // 显示：在 PotContents 下生成一个节点，按入锅顺序排成 2 列小网格
        if (this.potContentsNode) {
            const node = this.createIngredientNode(id);
            // 锅内显示用小号（55×55），更像"食材在锅里"，而不是大图标
            const nodeUt = node.getComponent(UITransform);
            if (nodeUt) {
                nodeUt.setContentSize(55, 55);
            }
            this.potContentsNode.addChild(node);
            const idx = this.getPotSize() - 1;   // 新食材是第几个（从 0 开始）
            const col = idx % 3;                 // 列：0 / 1 / 2（每行 3 个）
            const row = Math.floor(idx / 3);     // 行
            // 3 列网格：列 x = -70 / 0 / +70；首行上移到锅口附近 y=190，每下行 -95
            node.setPosition((col - 1) * 70, 190 - row * 95, 0);
            const item = node.getComponent(IngredientItem);
            if (item) {
                item.isInPot = true; // 标记在锅里，拖出去时走"出锅"分支
            }
        }
        return true;
    }

    // ==================== 锅满提示（全屏） ====================

    /** 让全屏提示节点可点击：铺满可点击区域（大尺寸 UITransform），点击任意处立即隐藏（不等自动计时） */
    private makeFullscreenDismissible(node: Node, hideCb: () => void): void {
        let ut = node.getComponent(UITransform);
        if (!ut) {
            ut = node.addComponent(UITransform);
        }
        ut.setContentSize(5000, 5000); // 覆盖全屏：任意位置点击都能触发
        node.on(Node.EventType.TOUCH_END, hideCb, this);
    }

    /** 全屏提示：深红半透明遮罩盖满整屏 + 大号加粗白字，1.5 秒后自动消失（点击任意处立即消失） */
    private showToast(text: string): void {
        const canvasNode = this.node; // GameManager 挂在 Canvas 上，父节点就是画布
        if (!canvasNode) {
            return;
        }
        // 首次调用时动态创建：全屏遮罩节点 + 文字子节点
        if (!this.toastNode) {
            this.toastNode = new Node('FullscreenToast');
            this.toastNode.layer = Layers.Enum.UI_2D; // 必须 UI_2D 层，UI 相机才渲染（食材隐身同款坑）
            canvasNode.addChild(this.toastNode);      // 后加入 → 渲染在最上层

            // ① 遮罩用 Graphics 画满屏矩形（纯色填充，免贴图）
            this.toastNode.addComponent(Graphics);
            this.makeFullscreenDismissible(this.toastNode, this.hideToastCallback); // 点击任意处立即消失

            // ② 文字子节点（大号加粗白字）
            const labelNode = new Node('ToastLabel');
            labelNode.layer = Layers.Enum.UI_2D;
            this.toastNode.addChild(labelNode);
            const lut = labelNode.addComponent(UITransform);
            lut.setContentSize(750, 300);
            const label = labelNode.addComponent(Label);
            label.fontSize = 80;
            label.lineHeight = 104;
            label.isBold = true;   // 加粗
            label.color = new Color(255, 255, 255, 255);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
        }
        // 每次显示前：按当前画布尺寸重新铺满整屏 + 更新文字
        const canvasUt = canvasNode.getComponent(UITransform);
        const w = canvasUt ? canvasUt.width : 750;
        const h = canvasUt ? canvasUt.height : 1334;
        const g = this.toastNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = new Color(140, 30, 30, 190); // 深红半透明
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        }
        const label = this.toastNode.getComponentInChildren(Label);
        if (label) {
            label.string = text;
        }
        this.toastNode.setPosition(0, 0, 0); // 画布中心
        // 全屏提示互斥：显示当前这条时先隐藏其他提示，避免叠在一起
        if (this.successTipNode) {
            this.successTipNode.active = false;
        }
        if (this.failTipNode) {
            this.failTipNode.active = false;
        }
        if (this.winTipNode) {
            this.winTipNode.active = false;
        }
        this.toastNode.active = true;
        // 先取消旧定时，再重新计时（连续触发时不会提前消失）
        this.unschedule(this.hideToastCallback);
        this.scheduleOnce(this.hideToastCallback, 1.5);
    }

    /** 定时回调：隐藏提示（点击触发时也会走到这里） */
    private hideToastCallback(): void {
        this.unschedule(this.hideToastCallback); // 点击后取消还没到时的自动计时
        if (this.toastNode) {
            this.toastNode.active = false;
        }
    }

    /** 从锅里移除一个食材（只改数据；显示节点由调用方处理），返回是否成功移除 */
    public removeFromPot(id: IngredientId): boolean {
        const count = this.potContents.get(id) || 0;
        if (count <= 0) {
            return false;
        }
        if (count === 1) {
            this.potContents.delete(id);
        } else {
            this.potContents.set(id, count - 1);
        }
        log(`[GameManager] 出锅：${INGREDIENTS[id].name}（当前 ${this.potSummary()}）`);
        return true;
    }

    /** 把合成菜品节点移动到桌面（Desk 下居中靠下，锅底以下可见） */
    public moveToDesk(node: Node): void {
        // 用 Desk 作父容器（ResultDesk 曾被误放在锅高度，不依赖它）
        const target = this.deskNode || this.resultDeskNode;
        if (!target) {
            return;
        }
        target.addChild(node);
        node.setPosition(0, -100, 0);
        const item = node.getComponent(IngredientItem);
        if (item) {
            item.isInPot = false; // 恢复"可入锅"身份
        }
        // 加入桌面排布（自动分配槽位，避免产物互相重叠）
        this.resultNodes.push(node);
        this.relayoutDeskResults();
    }

    /** 查询锅内某食材数量 */
    public getPotCount(id: IngredientId): number {
        return this.potContents.get(id) || 0;
    }

    /** 锅内食材总个数 */
    public getPotSize(): number {
        let total = 0;
        this.potContents.forEach((count) => { total += count; });
        return total;
    }

    /** 返回只读的锅内容（供 UI 展示 / 判定使用） */
    public getPotContents(): ReadonlyMap<IngredientId, number> {
        return this.potContents;
    }

    /** 清空锅内食材：清数据 + 销毁锅内所有显示节点（重置 / 炒菜后消耗时用） */
    public clearPot(): void {
        this.potContents.clear();
        if (this.potContentsNode) {
            this.potContentsNode.destroyAllChildren();
        }
    }

    // ==================== 拖拽落点命中检测（P2-2） ====================

    /** 某 UI 屏幕坐标是否落在锅里 */
    public isPointInPot(uiPos: Vec2): boolean {
        return this.isPointInNode(uiPos, this.potContentsNode);
    }

    /** 某 UI 屏幕坐标是否落在桌面（拖回区） */
    public isPointInDesk(uiPos: Vec2): boolean {
        return this.isPointInNode(uiPos, this.deskNode);
    }

    /** 通用：判断 UI 屏幕坐标是否在指定节点的世界包围盒内 */
    private isPointInNode(uiPos: Vec2, node: Node | null): boolean {
        if (!node) {
            return false;
        }
        const ut = node.getComponent(UITransform);
        if (!ut) {
            return false;
        }
        // getBoundingBoxToWorld() 返回节点在世界坐标下的包围盒（UI 屏幕坐标同空间）
        return ut.getBoundingBoxToWorld().contains(uiPos);
    }

    // ==================== 炒菜流程 ====================

    /** 炒菜按钮回调 */
    private onCookClicked(): void {
        if (this.cooking) {
            return; // 进度条动画期间锁定交互，防止重复触发
        }
        if (this.getPotSize() === 0) {
            warn('[GameManager] 锅里没有食材，无法炒菜');
            return;
        }
        // 桌面满：本次炒菜不执行——食材保留在锅里（不消耗不消失），仅提示先拖走
        this.resultNodes = this.resultNodes.filter((n) => n && n.isValid);
        if (this.resultNodes.length >= 6) {
            const wouldMake = matchRecipe(this.potContents);
            const name = wouldMake !== null ? INGREDIENTS[wouldMake].name : '黑暗料理';
            log(`[GameManager] 桌面满，炒菜被阻止（食材保留）：本次本应生成 ${name}`);
            this.showToast('桌面满了！\n先拖走一些再炒菜');
            return;
        }
        // 锁交互 → 播放进度条动画（1.5s）→ 动画结束才判定结果
        this.cooking = true;
        this.playCookProgress();
    }

    /** 显示进度条并开始逐帧填充（UI/CookProgress 的 Sprite 改为 FILLED 水平填充） */
    private playCookProgress(): void {
        this.cookProgressElapsed = 0;
        const cp = this.cookProgressNode;
        if (cp) {
            cp.active = true;
            const sp = cp.getComponent(Sprite);
            if (sp) {
                sp.type = Sprite.Type.FILLED; // 整条进度条图 → 按填充比例显示
                sp.fillType = Sprite.FillType.HORIZONTAL;
                sp.fillRange = 0;
            }
        }
        this.schedule(this.cookProgressTick, 0); // 每帧更新
    }

    /** 每帧更新进度条填充比例；跑满后结束动画并判定炒菜结果 */
    private cookProgressTick(dt: number): void {
        this.cookProgressElapsed += dt;
        const t = Math.min(this.cookProgressElapsed / this.COOK_DURATION, 1);
        const cp = this.cookProgressNode;
        if (cp) {
            const sp = cp.getComponent(Sprite);
            if (sp) {
                sp.fillRange = t;
            }
        }
        if (t >= 1) {
            this.unschedule(this.cookProgressTick);
            this.finishCooking();
        }
    }

    /** 进度条结束：隐藏进度条、解锁交互，再按锅内容判定成败 */
    private finishCooking(): void {
        if (this.cookProgressNode) {
            this.cookProgressNode.active = false;
        }
        const product = matchRecipe(this.potContents);
        this.cooking = false;
        if (product === null) {
            this.onCookFail();
        } else {
            this.onCookSuccess(product);
        }
    }

    /** 成功分支：产出菜品、解锁图鉴、清空锅、连败中断 */
    private onCookSuccess(product: IngredientId): void {
        this.loseStreak = 0; // 成功即中断连续失败
        this.unlock(product);
        this.clearPot();
        log(`[GameManager] 炒菜成功：产出 ${INGREDIENTS[product].name}，图鉴已解锁`);
        // 产物显示到成品桌面（可继续拖回锅里当原料，形成合成链）
        this.spawnResultNode(product);
        // 成功提示：全屏"恭喜你获得了 XXX / 菜谱已解锁"
        this.showSuccessTip(INGREDIENTS[product].name);
        // 通关判定（用户拍板：做出目标菜品「葱花蛋炒饭」即通关）：
        // 先记标记，等成功提示关闭后再弹通关庆祝屏，避免两个全屏叠在一起
        if (INGREDIENTS[product].isTarget) {
            this.pendingWin = true;
        }
    }

    /** 失败分支：黑暗料理、清空锅、连败计数 +1 */
    private onCookFail(): void {
        this.loseStreak += 1;
        this.clearPot();
        log(`[GameManager] 炒菜失败：黑暗料理！连续失败 ${this.loseStreak} 次`);
        // 失败也"做出"一坨黑暗料理摆在成品桌面（看得见的失败反馈）
        this.spawnResultNode(IngredientId.DarkDish);
        // 顺序：先冒黑烟（覆盖在锅上层的特效，约 1.3s 动画）→ 动画快结束时再弹全屏失败提示。
        // 若同时弹，全屏炭黑遮罩会把黑烟完全盖住（黑烟挂 Canvas 顶层也看不见）。
        this.showSmokeFx();
        this.scheduleOnce(() => {
            this.showFailTip(this.loseStreak);
        }, 1.0);
    }

    /** 失败黑烟特效：挂 Canvas 顶层（后 addChild → 渲染在锅和 PotContents 之上），放大扩散后销毁。
     *  素材优先用属性直引（属性检查器拖入的 黑烟.png），否则 resources.load 兜底 */
    private showSmokeFx(): void {
        const parent = this.node; // Canvas 直接子节点：最后加入 = 最上层，必定盖在锅上面
        const smoke = new Node('SmokeFx');
        smoke.layer = Layers.Enum.UI_2D;
        parent.addChild(smoke);
        smoke.addComponent(UITransform).setContentSize(480, 480);
        const sp = smoke.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        // 锅 (0,50) 550×550 → 世界顶边约 y=992；黑烟中心放 y=300（世界≈967），烟体覆盖锅顶
        smoke.setPosition(0, 300, 0);
        smoke.setScale(0.4, 0.4, 1);
        // 优先用属性直引（属性检查器拖入的 黑烟.png，最稳）；否则 resources.load 兜底
        if (this.smokeFrame) {
            sp.spriteFrame = this.smokeFrame;
        } else {
            resources.load('黑烟', SpriteFrame, (err, sf) => {
                if (err || !sf) {
                    warn(`[GameManager] 黑烟素材加载失败（请在 GameManager 属性检查器「黑烟特效图」拖入黑烟.png）：${err ?? '资源不存在'}`);
                    if (smoke.isValid) {
                        smoke.destroy();
                    }
                    return;
                }
                if (sp.isValid) {
                    sp.spriteFrame = sf;
                }
            });
        }
        // 扩散 + 淡出动画，1.3s 后销毁
        tween(smoke)
            .to(0.5, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'quadOut' })
            .to(0.8, { scale: new Vec3(1.25, 1.25, 1) })
            .call(() => {
                if (smoke.isValid) {
                    smoke.destroy();
                }
            })
            .start();
    }

    /** 在桌面生成一个产物节点（成功菜品 / 失败黑暗料理），可继续拖拽。
     *  父容器用 Desk（世界坐标稳定），不用 ResultDesk——它曾被误放在锅的高度，产物会被锅挡住 */
    private spawnResultNode(id: IngredientId): void {
        if (!this.deskNode) {
            warn('[GameManager] 桌面节点为空，产物无法显示');
            return;
        }
        // 黑暗料理若还没配图，不摆盘（失败反馈由全屏失败提示 showFailTip 负责）
        if (id === IngredientId.DarkDish && !this.darkDishFrame) {
            return;
        }
        const node = this.createIngredientNode(id);
        this.deskNode.addChild(node);
        // 放在桌面靠下位置：Desk 本地 (0,-100) → 世界约 (375,462)，在锅底(~532)以下的可见区
        node.setPosition(0, -100, 0);
        const nodeUt = node.getComponent(UITransform);
        if (nodeUt) {
            nodeUt.setContentSize(100, 100); // 产物图标加大，一眼可见
        }
        const item = node.getComponent(IngredientItem);
        if (item) {
            item.isInPot = false; // 可再次拖进锅（黑暗料理也可入锅）
        }
        // 几何诊断（每个会话只打一次）：Desk / 锅 / 开始炒菜按钮 的世界包围盒，用于核对排布是否与场景一致
        if (!this.geomLogged) {
            this.geomLogged = true;
            const box = (b: { xMin: number; yMin: number; xMax: number; yMax: number } | null | undefined): string =>
                b ? `(${b.xMin.toFixed(0)},${b.yMin.toFixed(0)})-(${b.xMax.toFixed(0)},${b.yMax.toFixed(0)})` : 'null';
            log(`[几何诊断] Desk=${box(this.deskNode.getComponent(UITransform)?.getBoundingBoxToWorld())} Pot=${box(this.potContentsNode?.getComponent(UITransform)?.getBoundingBoxToWorld())} CookBtn=${box(find('UI/CookButton')?.getComponent(UITransform)?.getBoundingBoxToWorld())}`);
        }
        // 桌面容量上限：3 列 × 2 行 = 6 个（再多会撞到底部食材栏）；先清理已销毁节点再计数
        this.resultNodes = this.resultNodes.filter((n) => n && n.isValid);
        if (this.resultNodes.length >= 6) {
            this.showToast('桌面满了！\n先拖走一些再炒菜');
            node.destroy();
            return;
        }
        // 加入桌面排布：自动分配槽位，避免多个产物/黑暗料理互相重叠
        this.resultNodes.push(node);
        this.relayoutDeskResults();
        // 调试：打印产物 / Desk 的世界坐标
        const wp = node.worldPosition;
        const dkp = this.deskNode.worldPosition;
        log(`[GameManager] 产物 ${INGREDIENTS[id].name} 生成：世界(${wp.x.toFixed(0)},${wp.y.toFixed(0)})，Desk世界(${dkp.x.toFixed(0)},${dkp.y.toFixed(0)})`);
    }

    /** 桌面产物排布：固定 3 列 × 最多 3 行（x=-100/0/100，行 y=-100/-205/-310，行距 105）。
     *  用户明确要求"第 5 个菜品出现在第二行"：第 4~6 个自动落到第二行。
     *  【关键】行距 105 必须 ≥ 产物高度 100——v1/v2 曾用 60/45，导致上下行互相遮挡
     *  （第二行的菜品被第一行盖住上半截），这就是"第 5 个菜品被挡住"的真正原因。 */
    private relayoutDeskResults(): void {
        this.resultNodes = this.resultNodes.filter((n) => n && n.isValid);
        this.resultNodes.forEach((n, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            n.setPosition((col - 1) * 100, -100 - row * 105, 0);
        });
    }

    /** 重置按钮回调：清空锅内食材（不重置连败计数，仅清锅）；炒菜动画期间禁用 */
    private onResetClicked(): void {
        if (this.cooking) {
            return;
        }
        this.clearPot();
        log('[GameManager] 点击重置：锅内食材已清空');
    }

    /** 菜谱按钮回调：开关图鉴面板；炒菜动画期间禁用 */
    private onBookClicked(): void {
        if (this.cooking) {
            return;
        }
        this.toggleBookPanel();
    }

    // ==================== 成功提示（全屏） ====================

    /** 全屏成功提示：米黄遮罩 + "恭喜你获得了 XXX" + "菜谱已解锁！"，2 秒后自动消失 */
    private showSuccessTip(productName: string): void {
        const canvasNode = this.node; // GameManager 挂在 Canvas 上
        if (!canvasNode) {
            return;
        }
        if (!this.successTipNode) {
            this.successTipNode = new Node('SuccessTip');
            this.successTipNode.layer = Layers.Enum.UI_2D;
            canvasNode.addChild(this.successTipNode); // 后加入 → 渲染在最上层
            this.successTipNode.addComponent(Graphics); // 遮罩
            this.makeFullscreenDismissible(this.successTipNode, this.hideSuccessTipCallback); // 点击任意处立即消失

            // 三个文字子节点：标题 / 菜名 / 解锁提示
            const mkLabel = (name: string, y: number, fontSize: number, color: Color, bold: boolean): void => {
                const n = new Node(name);
                n.layer = Layers.Enum.UI_2D;
                this.successTipNode!.addChild(n);
                const ut = n.addComponent(UITransform);
                ut.setContentSize(700, 150);
                const lb = n.addComponent(Label);
                lb.fontSize = fontSize;
                lb.lineHeight = Math.round(fontSize * 1.25);
                lb.isBold = bold;
                lb.color = color;
                lb.horizontalAlign = Label.HorizontalAlign.CENTER;
                lb.verticalAlign = Label.VerticalAlign.CENTER;
                n.setPosition(0, y, 0);
            };
            mkLabel('TipTitle', 170, 52, new Color(120, 80, 40, 255), false);   // 恭喜你获得了
            mkLabel('TipName', 30, 110, new Color(150, 60, 30, 255), true);      // 菜名（大号加粗）
            mkLabel('TipUnlock', -110, 34, new Color(180, 140, 60, 255), false); // 菜谱已解锁！
        }
        const canvasUt = canvasNode.getComponent(UITransform);
        const w = canvasUt ? canvasUt.width : 750;
        const h = canvasUt ? canvasUt.height : 1334;
        const g = this.successTipNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = new Color(255, 246, 230, 245); // 米黄不透明
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        }
        const title = this.successTipNode.getChildByName('TipTitle')?.getComponent(Label);
        if (title) {
            title.string = '恭喜你获得了';
        }
        const name = this.successTipNode.getChildByName('TipName')?.getComponent(Label);
        if (name) {
            name.string = productName;
        }
        const unlock = this.successTipNode.getChildByName('TipUnlock')?.getComponent(Label);
        if (unlock) {
            unlock.string = '菜谱已解锁！';
        }
        this.successTipNode.active = true;
        // 全屏提示互斥：先隐藏锅满提示、失败提示与通关屏
        if (this.toastNode) {
            this.toastNode.active = false;
        }
        if (this.failTipNode) {
            this.failTipNode.active = false;
        }
        if (this.winTipNode) {
            this.winTipNode.active = false;
        }
        this.unschedule(this.hideSuccessTipCallback);
        this.scheduleOnce(this.hideSuccessTipCallback, 2.0);
    }

    /** 定时回调：隐藏成功提示（点击触发时也会走到这里） */
    private hideSuccessTipCallback(): void {
        this.unschedule(this.hideSuccessTipCallback); // 点击后取消还没到时的自动计时
        if (this.successTipNode) {
            this.successTipNode.active = false;
        }
        // 若本次成功做的是目标菜品 → 成功提示关闭后弹通关庆祝屏
        if (this.pendingWin) {
            this.pendingWin = false;
            this.showWinScreen();
        }
    }

    // ==================== 通关庆祝屏 ====================

    /** 通关庆祝屏：金色全屏 + "恭喜通关！/ 葱花蛋炒饭 / 你做出了目标菜品，通关啦！" + 再来一局（点击任意处关闭） */
    private showWinScreen(): void {
        const canvasNode = this.node;
        if (!canvasNode) {
            return;
        }
        if (!this.winTipNode) {
            this.winTipNode = new Node('WinTip');
            this.winTipNode.layer = Layers.Enum.UI_2D;
            canvasNode.addChild(this.winTipNode);
            this.winTipNode.addComponent(Graphics); // 遮罩
            this.makeFullscreenDismissible(this.winTipNode, this.hideWinTipCallback);

            const mkLabel = (name: string, y: number, fontSize: number, color: Color, bold: boolean): void => {
                const n = new Node(name);
                n.layer = Layers.Enum.UI_2D;
                this.winTipNode!.addChild(n);
                const ut = n.addComponent(UITransform);
                ut.setContentSize(700, 150);
                const lb = n.addComponent(Label);
                lb.fontSize = fontSize;
                lb.lineHeight = Math.round(fontSize * 1.25);
                lb.isBold = bold;
                lb.color = color;
                lb.horizontalAlign = Label.HorizontalAlign.CENTER;
                lb.verticalAlign = Label.VerticalAlign.CENTER;
                n.setPosition(0, y, 0);
            };
            // 星星特效（先 addChild → 渲染在菜图下层）：通关时在菜图周围绽放
            const star = new Node('WinStar');
            star.layer = Layers.Enum.UI_2D;
            this.winTipNode.addChild(star);
            const starUt = star.addComponent(UITransform);
            starUt.setContentSize(700, 400);
            const starSp = star.addComponent(Sprite);
            starSp.sizeMode = Sprite.SizeMode.CUSTOM;
            star.setPosition(0, 200, 0);
            star.setScale(0.35, 0.35, 1);
            // 优先用属性直引（属性检查器拖入的 星星特效.png，最稳）；否则 resources.load 兜底
            if (this.starFrame) {
                starSp.spriteFrame = this.starFrame;
                tween(star)
                    .to(0.7, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                    .start();
            } else {
                resources.load('星星特效', SpriteFrame, (err, sf) => {
                    if (err || !sf) {
                        warn(`[GameManager] 星星特效素材加载失败（请在 GameManager 属性检查器「星星特效图」拖入星星特效.png）：${err ?? '资源不存在'}`);
                        return;
                    }
                    if (starSp.isValid) {
                        starSp.spriteFrame = sf;
                        tween(star)
                            .to(0.7, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                            .start();
                    }
                });
            }

            // 葱花蛋炒饭大图（目标菜品）：通关屏主角
            const dish = new Node('WinDish');
            dish.layer = Layers.Enum.UI_2D;
            this.winTipNode.addChild(dish);
            const du = dish.addComponent(UITransform);
            du.setContentSize(210, 210);
            const ds = dish.addComponent(Sprite);
            ds.sizeMode = Sprite.SizeMode.CUSTOM; // 先 CUSTOM 再赋图，避免 2048 巨图
            for (const id of PRODUCT_IDS) {
                if (INGREDIENTS[id].isTarget) {
                    ds.spriteFrame = this.getFrame(id);
                    break;
                }
            }
            dish.setPosition(0, 200, 0);

            mkLabel('WinTitle', 35, 52, new Color(150, 60, 30, 255), true); // 恭喜获得葱花蛋炒饭
            mkLabel('WinSub', -55, 48, new Color(120, 80, 40, 255), true);  // 恭喜通关！
            const winTitleLb = this.winTipNode.getChildByName('WinTitle')?.getComponent(Label);
            if (winTitleLb) {
                winTitleLb.string = '恭喜获得葱花蛋炒饭';
            }
            const winSubLb = this.winTipNode.getChildByName('WinSub')?.getComponent(Label);
            if (winSubLb) {
                winSubLb.string = '恭喜通关！';
            }

            // CTA：再来一局按钮（点击即重置进度重开一局）
            const btn = new Node('WinRestartBtn');
            btn.layer = Layers.Enum.UI_2D;
            this.winTipNode.addChild(btn);
            const btnUt = btn.addComponent(UITransform);
            btnUt.setContentSize(280, 104);
            const btnG = btn.addComponent(Graphics);
            btnG.fillColor = new Color(230, 120, 70, 255);
            btnG.roundRect(-140, -52, 280, 104, 22);
            btnG.fill();
            const btnLabel = new Node('Label');
            btnLabel.layer = Layers.Enum.UI_2D;
            btn.addChild(btnLabel);
            const blUt = btnLabel.addComponent(UITransform);
            blUt.setContentSize(280, 60);
            const bl = btnLabel.addComponent(Label);
            bl.fontSize = 38;
            bl.lineHeight = 46;
            bl.isBold = true;
            bl.color = new Color(255, 255, 255, 255);
            bl.horizontalAlign = Label.HorizontalAlign.CENTER;
            bl.verticalAlign = Label.VerticalAlign.CENTER;
            bl.string = '再来一局';
            btn.setPosition(0, -240, 0);
            btn.on(Node.EventType.TOUCH_END, () => this.restartGame(), this);
        }
        const canvasUt = canvasNode.getComponent(UITransform);
        const w = canvasUt ? canvasUt.width : 750;
        const h = canvasUt ? canvasUt.height : 1334;
        const g = this.winTipNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = new Color(255, 224, 130, 248); // 金色庆祝
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        }
        this.winTipNode.active = true;
        // 与其他全屏提示互斥
        if (this.toastNode) {
            this.toastNode.active = false;
        }
        if (this.successTipNode) {
            this.successTipNode.active = false;
        }
        if (this.failTipNode) {
            this.failTipNode.active = false;
        }
        log('[GameManager] 通关！做出了目标菜品：葱花蛋炒饭');
    }

    /** 关闭通关屏（点击任意处） */
    private hideWinTipCallback(): void {
        if (this.winTipNode) {
            this.winTipNode.active = false;
        }
    }

    /** 再来一局：清空锅/桌面/解锁进度，重新铺满基础食材 */
    private restartGame(): void {
        this.clearPot();
        this.resultNodes.forEach((n) => n && n.isValid && n.destroy());
        this.resultNodes = [];
        this.loseStreak = 0;
        this.unlockedSet.clear();
        this.hintProgress.clear();
        try {
            sys.localStorage.removeItem('kitchen_unlocked_v1'); // 持久化进度一并清空
        } catch (e) {
            warn('[GameManager] 清除持久化进度失败：' + e);
        }
        if (this.winTipNode) {
            this.winTipNode.active = false;
        }
        // 重新铺满 7 种基础食材（清掉旧槽位节点再铺，保证每槽 1 个）
        if (this.ingredientBarNode) {
            for (const c of this.ingredientBarNode.children.slice()) {
                c.destroy();
            }
            for (let i = 0; i < BASIC_IDS.length; i++) {
                this.spawnBasicToBar(BASIC_IDS[i], i);
            }
        }
        log('[GameManager] 再来一局：锅/桌面/进度已清空，食材已补满');
    }

    /** 全屏失败提示：炭黑遮罩 + "很遗憾，做出了 黑暗料理" + 连败次数，2 秒后自动消失 */
    private showFailTip(loseStreak: number): void {
        const canvasNode = this.node;
        if (!canvasNode) {
            return;
        }
        if (!this.failTipNode) {
            this.failTipNode = new Node('FailTip');
            this.failTipNode.layer = Layers.Enum.UI_2D;
            canvasNode.addChild(this.failTipNode);
            this.failTipNode.addComponent(Graphics); // 遮罩
            this.makeFullscreenDismissible(this.failTipNode, this.hideFailTipCallback); // 点击任意处立即消失

            const mkLabel = (name: string, y: number, fontSize: number, color: Color, bold: boolean): void => {
                const n = new Node(name);
                n.layer = Layers.Enum.UI_2D;
                this.failTipNode!.addChild(n);
                const ut = n.addComponent(UITransform);
                ut.setContentSize(700, 150);
                const lb = n.addComponent(Label);
                lb.fontSize = fontSize;
                lb.lineHeight = Math.round(fontSize * 1.25);
                lb.isBold = bold;
                lb.color = color;
                lb.horizontalAlign = Label.HorizontalAlign.CENTER;
                lb.verticalAlign = Label.VerticalAlign.CENTER;
                n.setPosition(0, y, 0);
            };
            mkLabel('TipTitle', 170, 52, new Color(230, 230, 230, 255), false);   // 很遗憾，做出了
            mkLabel('TipName', 30, 110, new Color(255, 255, 255, 255), true);      // 黑暗料理（大号加粗）
            mkLabel('TipSub', -110, 34, new Color(190, 190, 190, 255), false);     // 连败提示
        }
        const canvasUt = canvasNode.getComponent(UITransform);
        const w = canvasUt ? canvasUt.width : 750;
        const h = canvasUt ? canvasUt.height : 1334;
        const g = this.failTipNode.getComponent(Graphics);
        if (g) {
            g.clear();
            g.fillColor = new Color(70, 66, 62, 245); // 炭黑不透明
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        }
        const title = this.failTipNode.getChildByName('TipTitle')?.getComponent(Label);
        if (title) {
            title.string = '很遗憾，做出了';
        }
        const name = this.failTipNode.getChildByName('TipName')?.getComponent(Label);
        if (name) {
            name.string = INGREDIENTS[IngredientId.DarkDish].name;
        }
        const sub = this.failTipNode.getChildByName('TipSub')?.getComponent(Label);
        if (sub) {
            sub.string = loseStreak >= 2 ? `连续失败 ${loseStreak} 次，再接再厉！` : '失败了，再接再厉！';
        }
        this.failTipNode.active = true;
        // 全屏提示互斥：先隐藏锅满提示、成功提示与通关屏
        if (this.toastNode) {
            this.toastNode.active = false;
        }
        if (this.successTipNode) {
            this.successTipNode.active = false;
        }
        if (this.winTipNode) {
            this.winTipNode.active = false;
        }
        this.unschedule(this.hideFailTipCallback);
        this.scheduleOnce(this.hideFailTipCallback, 2.0);
    }

    /** 定时回调：隐藏失败提示（点击触发时也会走到这里） */
    private hideFailTipCallback(): void {
        this.unschedule(this.hideFailTipCallback); // 点击后取消还没到时的自动计时
        if (this.failTipNode) {
            this.failTipNode.active = false;
        }
        // 连败达到阈值后询问是否需要菜谱提示（点击关闭失败提示时触发）
        this.askForHintIfNeeded();
    }

    // ==================== 连败提示（询问 + 菜谱提示） ====================

    /** 通用小面板：半透明遮罩 + 白卡片 + 标题 + 若干选项按钮（点击按钮后关闭并回调） */
    private showHintPanel(title: string, options: { label: string; onTap: () => void }[]): void {
        const canvasNode = this.node;
        if (!canvasNode) {
            return;
        }
        // 重复弹窗时先销毁旧的
        if (this.hintPanelNode) {
            this.hintPanelNode.destroy();
            this.hintPanelNode = null;
        }
        const panel = new Node('HintPanel');
        panel.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(panel);
        this.hintPanelNode = panel;

        // ① 全屏半透明遮罩：吞掉背后点击（注册监听即拦截，避免穿透到游戏按钮）
        const overlayUt = panel.addComponent(UITransform);
        overlayUt.setContentSize(5000, 5000);
        const overlayG = panel.addComponent(Graphics);
        overlayG.fillColor = new Color(20, 20, 25, 165);
        overlayG.rect(-2500, -2500, 5000, 5000);
        overlayG.fill();
        panel.on(Node.EventType.TOUCH_END, () => { /* 仅拦截，不做动作 */ }, this);

        // ② 白卡片（加高：配方提示多行显示也放得下，按钮下移到卡片底部）
        const card = new Node('HintCard');
        card.layer = Layers.Enum.UI_2D;
        panel.addChild(card);
        const cardUt = card.addComponent(UITransform);
        cardUt.setContentSize(560, 370);
        const cardG = card.addComponent(Graphics);
        cardG.fillColor = new Color(255, 248, 230, 255);
        cardG.roundRect(-280, -185, 560, 370, 24);
        cardG.fill();

        // ③ 标题（支持显式 \n 多行；容器加高到 190，最多放 4 行配方）
        const titleNode = new Node('HintTitle');
        titleNode.layer = Layers.Enum.UI_2D;
        card.addChild(titleNode);
        const titleUt = titleNode.addComponent(UITransform);
        titleUt.setContentSize(520, 190);
        const titleLb = titleNode.addComponent(Label);
        titleLb.fontSize = 36;
        titleLb.lineHeight = 46;
        titleLb.isBold = true;
        titleLb.color = new Color(60, 45, 30, 255);
        titleLb.horizontalAlign = Label.HorizontalAlign.CENTER;
        titleLb.verticalAlign = Label.VerticalAlign.CENTER;
        titleLb.overflow = Label.Overflow.NONE; // 显式换行（\n），不自动裁切
        titleLb.string = title;
        titleNode.setPosition(0, 120, 0);

        // ④ 选项按钮（需要 / 不需要 / 知道了）
        const gap = 250;
        const startX = -((options.length - 1) * gap) / 2;
        options.forEach((opt, i) => {
            const btn = new Node(`HintBtn_${i}`);
            btn.layer = Layers.Enum.UI_2D;
            card.addChild(btn);
            const btnUt = btn.addComponent(UITransform);
            btnUt.setContentSize(220, 96);
            const btnG = btn.addComponent(Graphics);
            const btnColor = options.length === 1
                ? new Color(230, 120, 70, 255)
                : (i === 0 ? new Color(230, 120, 70, 255) : new Color(150, 150, 150, 255));
            btnG.fillColor = btnColor;
            btnG.roundRect(-110, -48, 220, 96, 20);
            btnG.fill();
            const btnLabel = new Node('Label');
            btnLabel.layer = Layers.Enum.UI_2D;
            btn.addChild(btnLabel);
            const blUt = btnLabel.addComponent(UITransform);
            blUt.setContentSize(220, 60);
            const bl = btnLabel.addComponent(Label);
            bl.fontSize = 34;
            bl.lineHeight = 42;
            bl.isBold = true;
            bl.color = new Color(255, 255, 255, 255);
            bl.horizontalAlign = Label.HorizontalAlign.CENTER;
            bl.verticalAlign = Label.VerticalAlign.CENTER;
            bl.string = opt.label;
            btn.setPosition(startX + i * gap, -135, 0);
            btn.on(Node.EventType.TOUCH_END, () => {
                if (this.hintPanelNode) {
                    this.hintPanelNode.destroy();
                    this.hintPanelNode = null;
                }
                opt.onTap();
            }, this);
        });
    }

    /** 失败提示关闭后调用：连败 ≥3 且还有菜谱未解锁 → 弹出询问面板 */
    private askForHintIfNeeded(): void {
        if (this.loseStreak < 3) {
            return;
        }
        if (this.isAllUnlocked()) {
            return;
        }
        this.showHintPanel('需要菜谱提示吗？', [
            { label: '需要', onTap: () => this.giveHint() },
            { label: '不需要', onTap: () => { /* 玩家继续自己尝试 */ } },
        ]);
    }

    /** 给出提示：优先提示未解锁的非目标菜品；只剩目标菜品未解锁时提示目标 */
    private giveHint(): void {
        const target = this.pickHintTarget();
        if (target === null) {
            this.showHintPanel('所有菜谱都已解锁！', [{ label: '知道了', onTap: () => { /* 已通关 */ } }]);
            return;
        }
        const recipe = RECIPES.find((r) => r.product === target);
        if (!recipe) {
            return;
        }
        // 本次多揭示一位食材（"再次逐渐解锁多位提示"：第一次 1 位、第二次 2 位……直到完整配方）
        const progress = (this.hintProgress.get(target) || 0) + 1;
        this.hintProgress.set(target, progress);
        // 已揭示的按顺序显示；未揭示的食材用「？」占位，让玩家知道菜谱还没完整
        const parts: string[] = recipe.requires.map((r, i) =>
            i < progress ? `${INGREDIENTS[r.id].name} ×${r.min}` : '？'
        );
        // 分行显示，避免文字超出卡片被切掉：菜名单独一行，食材每行最多 2 个
        const lines: string[] = [`${INGREDIENTS[target].name}：`];
        for (let i = 0; i < parts.length; i += 2) {
            lines.push(parts.slice(i, i + 2).join(' + '));
        }
        const text = lines.join('\n');
        log(`[GameManager] 菜谱提示：${text.replace(/\n/g, ' / ')}`);
        this.showHintPanel(text, [{ label: '知道了', onTap: () => { /* 继续游戏 */ } }]);
    }

    /** 选择提示目标：按图鉴顺序优先选未解锁的非目标菜品；全部非目标已解锁则选目标菜品 */
    private pickHintTarget(): IngredientId | null {
        for (const id of PRODUCT_IDS) {
            if (INGREDIENTS[id].isTarget) {
                continue; // 目标菜品最后提示
            }
            if (!this.unlockedSet.has(id)) {
                return id;
            }
        }
        for (const id of PRODUCT_IDS) {
            if (INGREDIENTS[id].isTarget && !this.unlockedSet.has(id)) {
                return id;
            }
        }
        return null; // 全部已解锁
    }

    /** 是否已解锁全部合成菜品（通关条件） */
    private isAllUnlocked(): boolean {
        return PRODUCT_IDS.every((id) => this.unlockedSet.has(id));
    }

    // ==================== 菜谱图鉴面板 ====================

    /** 开关图鉴面板（首次打开时动态构建） */
    private toggleBookPanel(): void {
        if (!this.bookPanelNode) {
            this.buildBookPanel();
        }
        this.bookPanelVisible = !this.bookPanelVisible;
        if (this.bookPanelNode) {
            this.bookPanelNode.active = this.bookPanelVisible;
        }
        if (this.bookPanelVisible) {
            this.refreshBookPanel();
            log('[GameManager] 打开菜谱图鉴');
        }
    }

    /** 构建图鉴面板：半透明黑遮罩（点击关闭）+ 白卡片 + 5 个菜品格子 */
    private buildBookPanel(): void {
        const canvasNode = this.node;
        if (!canvasNode) {
            return;
        }
        const panel = new Node('BookPanel');
        panel.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(panel);
        this.bookPanelNode = panel; // 关键：保存引用，否则 refreshBookPanel / 点击关闭都找不到面板
        const put = panel.addComponent(UITransform);
        put.setContentSize(750, 1334);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = new Color(0, 0, 0, 160); // 半透明黑遮罩
        pg.rect(-375, -667, 750, 1334);
        pg.fill();
        // 点击面板任意处（含卡片、格子）→ 关闭：触摸事件会从子节点冒泡到 panel
        panel.on(Node.EventType.TOUCH_END, () => {
            this.bookPanelVisible = false;
            if (this.bookPanelNode) {
                this.bookPanelNode.active = false;
            }
        }, this);

        // 白色卡片
        const card = new Node('Card');
        card.layer = Layers.Enum.UI_2D;
        panel.addChild(card);
        const cut = card.addComponent(UITransform);
        cut.setContentSize(560, 980);
        const cg = card.addComponent(Graphics);
        cg.fillColor = new Color(255, 252, 246, 255);
        cg.roundRect(-280, -490, 560, 980, 24);
        cg.fill();

        // 标题
        const titleNode = new Node('Title');
        titleNode.layer = Layers.Enum.UI_2D;
        card.addChild(titleNode);
        const tut = titleNode.addComponent(UITransform);
        tut.setContentSize(560, 90);
        const title = titleNode.addComponent(Label);
        title.string = '菜谱图鉴';
        title.fontSize = 44;
        title.isBold = true;
        title.color = new Color(120, 80, 40, 255);
        title.horizontalAlign = Label.HorizontalAlign.CENTER;
        title.verticalAlign = Label.VerticalAlign.CENTER;
        titleNode.setPosition(0, 420, 0);

        // 格子内文字工厂
        const mkCellLabel = (parent: Node, labelName: string, y: number, fontSize: number, bold: boolean, color: Color, wrap: boolean): Label => {
            const n = new Node(labelName);
            n.layer = Layers.Enum.UI_2D;
            parent.addChild(n);
            const ut = n.addComponent(UITransform);
            ut.setContentSize(210, 90);
            const lb = n.addComponent(Label);
            lb.fontSize = fontSize;
            lb.lineHeight = Math.round(fontSize * 1.35);
            lb.isBold = bold;
            lb.color = color;
            lb.horizontalAlign = Label.HorizontalAlign.CENTER;
            lb.verticalAlign = Label.VerticalAlign.CENTER;
            lb.enableWrapText = wrap;
            n.setPosition(0, y, 0);
            return lb;
        };

        // 5 个菜品格子（2 列 × 3 行）
        for (let i = 0; i < PRODUCT_IDS.length; i++) {
            const id = PRODUCT_IDS[i];
            const col = i % 2;
            const row = Math.floor(i / 2);
            const cell = new Node(`Cell_${id}`);
            cell.layer = Layers.Enum.UI_2D;
            card.addChild(cell);
            const cutt = cell.addComponent(UITransform);
            cutt.setContentSize(230, 250);
            cell.setPosition(col === 0 ? -125 : 125, 250 - row * 280, 0);

            // 图标（未解锁时置空，用问号代替）
            const iconNode = new Node('Icon');
            iconNode.layer = Layers.Enum.UI_2D;
            cell.addChild(iconNode);
            const iut = iconNode.addComponent(UITransform);
            iut.setContentSize(70, 70);
            const icon = iconNode.addComponent(Sprite);
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
            iconNode.setPosition(0, 62, 0);

            // 问号（未解锁显示）
            const qNode = new Node('Q');
            qNode.layer = Layers.Enum.UI_2D;
            cell.addChild(qNode);
            const qut = qNode.addComponent(UITransform);
            qut.setContentSize(70, 70);
            const q = qNode.addComponent(Label);
            q.string = '？';
            q.fontSize = 56;
            q.isBold = true;
            q.color = new Color(200, 200, 200, 255);
            q.horizontalAlign = Label.HorizontalAlign.CENTER;
            q.verticalAlign = Label.VerticalAlign.CENTER;
            qNode.setPosition(0, 62, 0);

            mkCellLabel(cell, 'Name', -8, 26, true, new Color(120, 80, 40, 255), false);
            mkCellLabel(cell, 'Status', -52, 20, false, new Color(180, 180, 180, 255), false);
            mkCellLabel(cell, 'Recipe', -100, 16, false, new Color(140, 140, 140, 255), true);
        }
    }

    /** 刷新图鉴内容：按解锁状态更新每个格子的图片/问号/配方 */
    private refreshBookPanel(): void {
        const card = this.bookPanelNode?.getChildByName('Card');
        if (!card) {
            return;
        }
        for (const id of PRODUCT_IDS) {
            const cell = card.getChildByName(`Cell_${id}`);
            if (!cell) {
                continue;
            }
            const unlocked = this.isUnlocked(id);
            const icon = cell.getChildByName('Icon')?.getComponent(Sprite);
            const q = cell.getChildByName('Q')?.getComponent(Label);
            const name = cell.getChildByName('Name')?.getComponent(Label);
            const status = cell.getChildByName('Status')?.getComponent(Label);
            const recipe = cell.getChildByName('Recipe')?.getComponent(Label);

            if (name) {
                name.string = INGREDIENTS[id].name;
            }
            if (icon) {
                icon.spriteFrame = unlocked ? this.getFrame(id) : null;
            }
            if (q) {
                q.node.active = !unlocked;
            }
            if (status) {
                status.string = unlocked ? '已解锁' : '未解锁';
                status.color = unlocked ? new Color(80, 160, 80, 255) : new Color(180, 180, 180, 255);
            }
            if (recipe) {
                recipe.string = unlocked ? this.recipeSummary(id) : '???';
            }
        }
    }

    /** 配方需求摘要，如 "大米×2 + 水×1" */
    private recipeSummary(product: IngredientId): string {
        const rec = RECIPES.find((r) => r.product === product);
        if (!rec) {
            return '';
        }
        return rec.requires.map((req) => `${INGREDIENTS[req.id].name}×${req.min}`).join(' + ');
    }

    /** 是否正在炒菜（拖拽脚本用它锁定交互） */
    public get isCooking(): boolean {
        return this.cooking;
    }

    // ==================== 图鉴 ====================

    /** 某菜品是否已解锁 */
    public isUnlocked(id: IngredientId): boolean {
        return this.unlockedSet.has(id);
    }

    /** 探测当前预览环境 localStorage 是否可用（编辑器预览 iframe 常拦截 → 发布到浏览器后正常） */
    private probeLocalStorage(): void {
        try {
            sys.localStorage.setItem('__kitchen_probe__', '1');
            const back = sys.localStorage.getItem('__kitchen_probe__');
            if (back === '1') {
                log('[GameManager] localStorage 可用：解锁进度可跨刷新保留');
            } else {
                warn('[GameManager] localStorage 读写异常：进度无法跨刷新保留');
            }
            sys.localStorage.removeItem('__kitchen_probe__');
        } catch (e) {
            warn(`[GameManager] localStorage 被预览环境拦截（发布到浏览器后通常正常），本次会话解锁仍有效：${e}`);
        }
    }

    /** 解锁一个菜品并持久化到 localStorage（刷新页面进度不丢） */
    public unlock(id: IngredientId): void {
        this.unlockedSet.add(id);
        try {
            sys.localStorage.setItem('kitchen_unlocked_v1', JSON.stringify(Array.from(this.unlockedSet)));
            log(`[GameManager] 解锁并已保存：${INGREDIENTS[id].name}（累计 ${this.unlockedSet.size} 道）`);
        } catch (e) {
            warn('[GameManager] 保存解锁进度失败（不影响本次游戏）：' + e);
        }
    }

    // ==================== 工具 ====================

    /** 把锅内容格式化成便于日志阅读的字符串，如 "大米×2 水×1" */
    private potSummary(): string {
        const parts: string[] = [];
        this.potContents.forEach((count, id) => {
            parts.push(`${INGREDIENTS[id].name}×${count}`);
        });
        return parts.length > 0 ? parts.join(' ') : '空';
    }
}
