using UnityEngine;

public class EventsManager : MonoBehaviour
{
    private Player player;

    public HoldingItem holdingItem;
    public PlantScriptableObject holdingSeed;
    public PlantScriptableObject holdingPlant;

    private void Start()
    {
        player = this.gameObject.GetComponent<Player>();
        holdingSeed = null;
        holdingItem = HoldingItem.NOTHING;
        holdingPlant = null;
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

            bool shouldResetHoldingItem = false;

            // Send interactions
            if (holdingItemToInteract == HoldingItem.SEED && plantSeedToInteract != null)
            {
                shouldResetHoldingItem = plantSlot.interact(plantSeedToInteract);
            }
            else
            {
                shouldResetHoldingItem = plantSlot.interact(holdingItemToInteract);
            }

            if (shouldResetHoldingItem)
            {
                // Clear references
                holdingSeed = null;
                holdingItem = HoldingItem.NOTHING;
            }
        }
    }

    private bool CanInteractWith<T>(T obj)
    {
        return (
            obj != null &&
            Input.GetKeyDown(KeyCode.E) &&
            holdingItem != HoldingItem.PLANT
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
