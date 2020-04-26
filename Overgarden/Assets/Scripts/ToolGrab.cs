using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class ToolGrab : MonoBehaviour
{
    private bool Interaction;
    public GameObject Player;
    public GameObject shovelPrefab;
    public GameObject spawnedTool;
    public GameObject position;
    public Text pressPick;
    
    void Start()
    {
        
    }

    
    void Update()
    {
        if (MenuManager.instance.isPaused) {
            return;
        }

        if (Interaction == true && Player.GetComponent<EventsManager>().holdingItem != HoldingItem.PLANT)
        {
            pressPick.enabled = true;

            if (Input.GetKeyDown(KeyCode.E))
            {
                // GameObject spawnedTool = Instantiate(shovelPrefab, position.transform.position, Quaternion.identity);
                // spawnedTool.transform.SetParent(Player.gameObject.transform);
               
                Player.gameObject.GetComponent<Player>().toolTrigger();
            }
        }
        else
        {
            pressPick.enabled = false;
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
       }  
    }
}
