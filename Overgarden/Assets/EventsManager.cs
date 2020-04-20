using UnityEngine;

public class EventsManager : MonoBehaviour
{
    private Player player;

    //[HideInInspector]
    public HoldingItem holdingItem;

    [HideInInspector]
    public PlantScriptableObject holdingSeed;

    [HideInInspector]
    public PlantScriptableObject holdingPlant;

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
            // Get references to send
            PlantScriptableObject plantSeedToInteract = holdingSeed;
            HoldingItem holdingItemToInteract = holdingItem;

            // Clear references
            holdingSeed = null;
            holdingItem = HoldingItem.NOTHING;

            // Send interactions
            if (holdingItemToInteract == HoldingItem.SEED && plantSeedToInteract != null)
            {
                plantSlot.interact(plantSeedToInteract);
            }
            else
            {
                plantSlot.interact(holdingItemToInteract);
            }
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
