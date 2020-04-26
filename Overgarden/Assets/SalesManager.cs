using System.Collections;
using UnityEngine;

public class SalesManager : MonoBehaviour
{
    public SpriteRenderer itemSprite;
    private int itemQuantity;
    private PlantScriptableObject sellingPlantType;

    private void Start()
    {
        itemSprite.sprite = null;
        itemQuantity = 0;
        sellingPlantType = null;

        StartCoroutine(SellItem());
    }

    IEnumerator SellItem()
    {
        while (true)
        {
            if (itemQuantity > 0)
            {
                itemQuantity -= 1;
                DataHolder.instance.AddScore(100);
            }
            if (itemQuantity == 0)
            {
                sellingPlantType = null;
                itemSprite.sprite = null;
            }
            yield return new WaitForSeconds(5f);
        }
    }

    private void OnTriggerStay2D(Collider2D other)
    {
        if (other.tag == "Player")
        {
            EventsManager eventsManager = other.gameObject.GetComponent<EventsManager>();
            if (eventsManager.holdingItem == HoldingItem.PLANT)
            {
                // Empty box case
                if (sellingPlantType == null)
                {
                    itemQuantity += 1;
                    sellingPlantType = eventsManager.holdingPlant;
                    itemSprite.sprite = sellingPlantType.main;
                    eventsManager.holdingPlant = null;
                    eventsManager.holdingItem = HoldingItem.NOTHING;
                    DataHolder.instance.AddScore(20);
                }
                // Not empty box case
                else
                {
                    // Putting same item on box
                    if (sellingPlantType.name == eventsManager.holdingPlant.name)
                    {
                        itemQuantity += 1;
                        eventsManager.holdingPlant = null;
                        eventsManager.holdingItem = HoldingItem.NOTHING;
                        DataHolder.instance.AddScore(20);
                    }
                    // Putting differente item on box
                    else
                    {
                        eventsManager.holdingPlant = null;
                        eventsManager.holdingItem = HoldingItem.NOTHING;
                        DataHolder.instance.AddScore(-20);
                    }
                }
            }
        }
    }
}
