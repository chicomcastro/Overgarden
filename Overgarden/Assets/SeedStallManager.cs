using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;

public class SeedStallManager : MonoBehaviour
{
    public Transform seedStallPanel;
    public GameObject seedItemPrefab;

    public PlantScriptableObject[] plantScriptableObjects;

    public Image[] menuImages;

    private int currentIndex;

    private void Start()
    {
        // Sort array by rarity
        Array.Sort<PlantScriptableObject>(
            plantScriptableObjects,
            delegate (
                PlantScriptableObject m,
                PlantScriptableObject n
            )
            {
                return m.plantRarity - n.plantRarity;
            }
        );

        SlideMenu(0);
    }

    private void Update()
    {
        if (!seedStallPanel.gameObject.activeInHierarchy)
        {
            if (Input.GetKeyDown(KeyCode.E) &&
                GameObject.FindObjectOfType<SeedStall>().Interaction)
            {
                GameObject.FindGameObjectWithTag("Player").GetComponent<Player>().isChoosingSeed = true;
                seedStallPanel.gameObject.SetActive(true);
            }
            return;
        }
        if (Input.GetKeyDown(KeyCode.A))    // Get correct button from controller
        {
            SlideMenu(-1);
        }
        if (Input.GetKeyDown(KeyCode.D))
        {
            SlideMenu(1);
        }
        if (Input.GetKeyDown(KeyCode.E))
        {
            GameObject.FindGameObjectWithTag("Player").GetComponent<Player>().isChoosingSeed = false;
            seedStallPanel.gameObject.SetActive(false);
            OnSelectionItem();
        }
    }

    private void SlideMenu(int direction)
    {
        if (currentIndex + direction < plantScriptableObjects.Length &&
            currentIndex + direction > -1)
        {
            currentIndex += direction;
        }
        // Prevent to continue if it's not in range
        else
        {
            return;
        }

        // Filter only max 5 and min 3 plants at time
        PlantScriptableObject[] filteredPsos = plantScriptableObjects.Where((item, index) =>
            index > currentIndex - 3 && index < currentIndex + 3
        ).ToArray();

        // Setting all images to null as default state
        foreach (Image image in menuImages)
        {
            image.sprite = null;
        }

        // Placing current plants on menus
        for (int i = 0; i < filteredPsos.Length; i++)
        {
            if (currentIndex == 0)
            {
                menuImages[i + 2].sprite = filteredPsos[i].main;
            }
            else if (currentIndex == 1)
            {
                menuImages[i + 1].sprite = filteredPsos[i].main;
            }
            else
            {
                menuImages[i].sprite = filteredPsos[i].main;
            }
        }

        // Correcting alpha channel
        for (int i = 0; i < menuImages.Length; i++)
        {
            Image image = menuImages[i];
            image.color = new Color(
                image.color.r,
                image.color.g,
                image.color.b,
                (image.sprite == null) ? 
                0 : 
                (
                    i % 2 == 1 ? 
                    200f / 255f : 
                    (
                        i == 2 ? 
                        1f :
                        100f / 255f
                    )
                )
            );
        }
    }

    public void OnSelectionItem()
    {
        EventsManager playerEM = GameObject.FindGameObjectWithTag("Player").GetComponent<EventsManager>();
        playerEM.holdingItem = HoldingItem.SEED;
        playerEM.holdingSeed = plantScriptableObjects[currentIndex];
    }
}
