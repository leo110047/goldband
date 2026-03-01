# State Machine 完整程式碼範例

## 簡單狀態機（switch-case）

```csharp
public enum EnemyState { Idle, Patrol, Chase, Attack }

public class EnemyAI : MonoBehaviour
{
    private EnemyState currentState;

    void Update()
    {
        switch (currentState)
        {
            case EnemyState.Idle:    IdleState();    break;
            case EnemyState.Patrol:  PatrolState();  break;
            case EnemyState.Chase:   ChaseState();   break;
            case EnemyState.Attack:  AttackState();  break;
        }
    }

    void IdleState()
    {
        if (ShouldPatrol())
            ChangeState(EnemyState.Patrol);
    }

    void ChangeState(EnemyState newState)
    {
        ExitState(currentState);
        currentState = newState;
        EnterState(newState);
    }

    void EnterState(EnemyState state) { /* 進入狀態邏輯 */ }
    void ExitState(EnemyState state) { /* 退出狀態邏輯 */ }
}
```

## OOP 狀態機（抽象 State 類）

### State 基類

```csharp
public abstract class State
{
    public abstract void Enter();
    public abstract void Execute();
    public abstract void Exit();
}
```

### 具體狀態

```csharp
public class IdleState : State
{
    private EnemyAI enemy;

    public IdleState(EnemyAI enemy) => this.enemy = enemy;

    public override void Enter() => enemy.StopMoving();

    public override void Execute()
    {
        if (enemy.CanSeePlayer())
            enemy.ChangeState(new ChaseState(enemy));
    }

    public override void Exit() { }
}

public class ChaseState : State
{
    private EnemyAI enemy;

    public ChaseState(EnemyAI enemy) => this.enemy = enemy;

    public override void Enter() => enemy.SetSpeed(10f);

    public override void Execute()
    {
        enemy.MoveTowards(enemy.Player.position);

        if (enemy.IsInAttackRange())
            enemy.ChangeState(new AttackState(enemy));
        else if (!enemy.CanSeePlayer())
            enemy.ChangeState(new IdleState(enemy));
    }

    public override void Exit() { }
}
```

### 狀態機宿主

```csharp
public class EnemyAI : MonoBehaviour
{
    private State currentState;

    void Start() => ChangeState(new IdleState(this));

    void Update() => currentState?.Execute();

    public void ChangeState(State newState)
    {
        currentState?.Exit();
        currentState = newState;
        currentState.Enter();
    }
}
```
