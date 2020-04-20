using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class WaterGrab : MonoBehaviour
{
    private bool Proximity = false;
    public Text pressGrab;
    public GameObject Player;
    public GameObject waterPrefab;
    public GameObject spawnedWater;
    public GameObject SpawnLocal;
    
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {
        if (Proximity == true)
        {
            pressGrab.enabled = true;
            if (Input.GetKeyDown(KeyCode.E) && spawnedWater == null)
            {
                
                GameObject spawnedWater = Instantiate(waterPrefab, SpawnLocal.transform.position, Quaternion.identity) as GameObject;
                spawnedWater.transform.SetParent(Player.gameObject.transform);
                
                Player.gameObject.GetComponent<Player>().waterTrigger();
            }
            
        }
        else
        {
            pressGrab.enabled = false;
        }


        

        
        
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
            Proximity = true;
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Proximity = false;
           
           
       }  
    }

    

}
