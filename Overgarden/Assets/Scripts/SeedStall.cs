using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SeedStall : MonoBehaviour
{
    private bool Interaction = false;
    public GameObject seedUI;
    public Text pressOpen;
    public GameObject SpawnPoint;
    public GameObject Player;
    public GameObject spawnedSeed;
    
    void Update()
    {
        if (MenuManager.instance.isPaused) {
            return;
        }
        
        if (Interaction == true && Player.GetComponent<EventsManager>().holdingItem != HoldingItem.PLANT)
        {
            pressOpen.enabled = true;    
            if (Input.GetKey(KeyCode.E))
            {
                seedUI.SetActive(true);
            }   
        }
        else
        {
            pressOpen.enabled = false;
        }
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = true;
       }
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = false;
           seedUI.SetActive(false);
       }
    }

    //Buttons
    public void CloseButton()
    {
        seedUI.SetActive(false);
    }
}
