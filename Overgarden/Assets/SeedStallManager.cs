using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SeedStallManager : MonoBehaviour
{
    public Transform seedStallPanel;
    public GameObject seedItemPrefab;

    public PlantScriptableObject[] plantScriptableObjects;

    private void Start()
    {
        // Create our seed inventory to choose from
        foreach (PlantScriptableObject pso in plantScriptableObjects)
        {
            // Instantiate
            GameObject gamo = Instantiate(seedItemPrefab, seedStallPanel);

            // Get grid item component that stores informations for us in prefab
            StallGridItem sgi = gamo.GetComponent<StallGridItem>();

            // Set its plant scriptable object and item cover on UI
            sgi.plant = pso;
            sgi.cover.sprite = pso.main;
        }
    }
}
