using UnityEngine;

public class EventsManager : MonoBehaviour
{
    private Player player;
    public HoldingItem holdingItem;
    public PlantScriptableObject holdingSeed;

    private void Start()
    {
        player = this.gameObject.GetComponent<Player>();
        holdingItem = HoldingItem.NOTHING;
    }
    private void OnTriggerStay2D(Collider2D other)
    {
        Transform slot = other.gameObject.GetComponentInChildren<Transform>();
        StageScript plantSlot = slot.gameObject.GetComponentInChildren<StageScript>();
        if (CanInteractWith<StageScript>(plantSlot))
        {
            if (holdingItem == HoldingItem.SEED && holdingSeed != null)
            {
                plantSlot.interact(holdingSeed);
            }
            else
            {
                plantSlot.interact(holdingItem);
            }
            holdingSeed = null;
            holdingItem = HoldingItem.NOTHING;
        }
    }

    private bool CanInteractWith<T>(T obj)
    {
        return (
            obj != null &&
            Input.GetKeyDown(KeyCode.E) &&
            holdingItem != HoldingItem.NOTHING
        );
    }

    public void SetHolding(HoldingItem newHoldingState)
    {
        holdingItem = newHoldingState;
    }
}

public enum HoldingItem
{
    NOTHING = 0,
    SEED = 1,
    WATER = 2,
    TOOL = 3,
    PLANT = 4
}
