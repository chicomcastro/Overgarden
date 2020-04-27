using UnityEngine;
using UnityEngine.UI;

public class StallGridItem : MonoBehaviour
{
    public PlantScriptableObject plant;
    public Image cover;

    // Function to be called when clicking on item button on UI
    public void OnSelectionItem() {
        EventsManager playerEM = GameObject.FindGameObjectWithTag("Player").GetComponent<EventsManager>();
        playerEM.holdingItem = HoldingItem.SEED;
        playerEM.holdingSeed = plant;
    }
}
