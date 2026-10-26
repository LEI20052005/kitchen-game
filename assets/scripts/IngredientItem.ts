/**
 * ============================================================
 * IngredientItem.ts —— 可拖拽食材节点组件
 *
 * 【职责】
 * - 挂在每个"食材节点"上（运行时由 GameManager.createIngredientNode 自动挂载，
 *   不需要在编辑器里手动添加）
 * - 处理触摸拖拽：按下 / 移动 / 抬起
 * - 拖拽落点判定：
 *     · 食材栏/桌面上的食材 → 拖进锅：入锅 + 本体销毁（基础食材自动补货）
 *     · 锅里的食材 → 拖到桌面：出锅（基础食材回食材栏、合成菜品移到成品桌面）
 *     · 其它情况 → 自动复原到原位置
 *
 * 【依赖】
 * - GameManager.instance：全局管理器（提供入锅/出锅/命中检测/补货等 API）
 * ============================================================
 */
import { _decorator, Component, Node, Vec3, EventTouch } from 'cc';
import { IngredientId, INGREDIENTS } from './GameConfig';
import { GameManager } from './GameManager';

const { ccclass } = _decorator;

@ccclass('IngredientItem')
export class IngredientItem extends Component {

    /** 食材 id（创建节点时由 GameManager 赋值） */
    public id: IngredientId = IngredientId.RiceRaw;
    /** 是否在锅里（决定拖出去后的去向：出锅 or 复原） */
    public isInPot = false;

    /** 是否正在拖拽 */
    private dragging = false;
    /** 手指与节点中心的偏移（避免按下时节点"跳一下"） */
    private dragOffset = new Vec3();
    /** 拖拽前的本地位置（用于自动复原） */
    private originPos = new Vec3();

    // ==================== 生命周期 ====================
    onLoad() {
        // Node 的触摸事件会自动派发给"UITransform 区域被点中"的节点。
        // TOUCH_START / MOVE / END / CANCEL 四件套是移动端拖拽的标准做法。
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    // ==================== 拖拽事件 ====================

    /** 按下：记录原位置与手指偏移，节点置顶 */
    private onTouchStart(event: EventTouch): void {
        // 炒菜动画期间锁定交互（P4 使用）
        if (GameManager.instance.isCooking) {
            return;
        }
        this.dragging = true;
        // 记录拖拽前的本地位置（复原用）
        this.originPos.set(this.node.position);
        // getUILocation() 返回 UI 屏幕坐标（左下角原点），与节点世界坐标同空间
        const uiPos = event.getUILocation();
        const world = this.node.getWorldPosition();
        // 偏移 = 手指位置 - 节点中心，移动时减去它，保证手指始终"抓住"节点中心附近
        this.dragOffset.set(uiPos.x - world.x, uiPos.y - world.y, 0);
        // setSiblingIndex(大数) 把节点放到父节点子列表末尾 = 置顶显示
        this.node.setSiblingIndex(1000);
    }

    /** 移动：把节点跟到手指位置（父节点坐标系） */
    private onTouchMove(event: EventTouch): void {
        if (!this.dragging) {
            return;
        }
        const uiPos = event.getUILocation();
        const parent = this.node.parent;
        if (!parent) {
            return;
        }
        // 目标世界坐标 = 手指 - 偏移；本地坐标 = 世界坐标 - 父节点世界坐标。
        // 前提：容器没有旋转/缩放（本项目成立，若有缩放需用 convertToNodeSpaceAR）
        const pw = parent.getWorldPosition();
        this.node.setPosition(
            uiPos.x - this.dragOffset.x - pw.x,
            uiPos.y - this.dragOffset.y - pw.y,
            0
        );
    }

    /** 抬起：判定落点 */
    private onTouchEnd(event: EventTouch): void {
        if (!this.dragging) {
            return;
        }
        this.dragging = false;
        const gm = GameManager.instance;
        const uiPos = event.getUILocation();

        if (this.isInPot) {
            // ===== 从锅里拖出来 =====
            if (gm.isPointInDesk(uiPos)) {
                // 落在桌面上：真正出锅
                gm.removeFromPot(this.id);
                if (INGREDIENTS[this.id].isBasic) {
                    // 基础食材 → 销毁本体，食材栏自动补一个新（无限刷新）
                    gm.respawnBasic(this.id);
                    this.node.destroy();
                } else {
                    // 合成菜品 → 移到成品桌面，之后还能再拖进锅当原料
                    gm.moveToDesk(this.node);
                }
            } else {
                // 没落在桌面：弹回锅里原位
                this.node.setPosition(this.originPos);
            }
            return;
        }

        // ===== 从食材栏 / 成品桌面拖出 =====
        if (gm.isPointInPot(uiPos)) {
            // 落进锅里：入锅 + 销毁本体（锅内的显示节点由 GameManager 生成）
            const ok = gm.addToPot(this.id);
            if (!ok) {
                // 锅满了（最多 9 个）：食材不放进去，弹回原位
                this.node.setPosition(this.originPos);
                return;
            }
            if (INGREDIENTS[this.id].isBasic) {
                // 基础食材被消耗 → 食材栏自动补货（无限刷新规则）
                gm.respawnBasic(this.id);
            }
            this.node.destroy();
        } else {
            // 没落进锅：自动复原到原位置（"拖走自动复原"）
            this.node.setPosition(this.originPos);
        }
    }

    /** 触摸被系统打断（来电等）：复原 */
    private onTouchCancel(): void {
        if (!this.dragging) {
            return;
        }
        this.dragging = false;
        this.node.setPosition(this.originPos);
    }
}
